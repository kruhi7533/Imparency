import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import Razorpay from "razorpay";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkFcraGate } from "@/lib/fcra-gate";
import { checkRateLimit } from "@/lib/rate-limiter";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Only donors can make donations" }, { status: 403 });
    }

    // Order creation is the one donation endpoint that costs money to abuse: it
    // opens a Razorpay order per call, which is the shape of a card-testing
    // run. 10/min is far above any real donor — a person retrying a failed
    // payment a few times never approaches it — and well below a useful attack
    // rate. `lib/risk-agent.ts` treats >5 donations in 10min as suspicious, so
    // anything getting close here is already worth an alert.
    const rl = await checkRateLimit(request, "donations/create-order", 10, 60);
    if (rl.isBlocked) return rl.response!;

    const body = await request.json();
    const { projectId, amount, milestoneIds = [] } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    if (!amount || typeof amount !== "number" || amount < 100) {
      return NextResponse.json({ error: "Amount must be a number and at least Rs. 100" }, { status: 400 });
    }

    // If milestoneIds are provided, verify they all belong to this project and are donatable
    if (milestoneIds && milestoneIds.length > 0) {
      const validMilestones = await prisma.milestone.findMany({
        where: {
          id: { in: milestoneIds },
          projectId,
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        select: { id: true },
      });

      if (validMilestones.length !== milestoneIds.length) {
        return NextResponse.json(
          { error: "One or more selected milestones are invalid or not accepting donations." },
          { status: 400 }
        );
      }
    }

    // Fetch project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { ngo: { select: { isSuspended: true, orgName: true } } },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.ngo?.isSuspended) {
      return NextResponse.json(
        { error: "NGO_SUSPENDED", message: "This NGO has been suspended and cannot receive donations at this time." },
        { status: 403 }
      );
    }

    if (project.status !== "ACTIVE") {
      return NextResponse.json({ error: "Project is not active and cannot receive donations" }, { status: 400 });
    }

    // ── FCRA gate ──────────────────────────────────────────────────────────────
    // Only applies to donors who have declared a non-domestic category.
    const freshUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { donorCategory: true, nriSourceDeclaration: true },
    });

    if (!freshUser) {
      return NextResponse.json(
        { error: "Stale session", message: "Your session has expired or your user account no longer exists. Please sign out and sign in again." },
        { status: 401 }
      );
    }

    const ngoCompliance = await prisma.nGOCompliance.findUnique({
      where: { ngoId: project.ngoId },
      select: { fcraStatus: true, fcraExpiryDate: true },
    });

    const fcraGate = checkFcraGate({
      donorCategory: freshUser?.donorCategory,
      nriSourceDeclaration: freshUser?.nriSourceDeclaration,
      ngoFcraExpiryDate: ngoCompliance?.fcraExpiryDate,
      ngoFcraStatus: ngoCompliance?.fcraStatus ?? "NONE",
    });

    if (!fcraGate.allowed) {
      return NextResponse.json(
        {
          error: fcraGate.reason,
          message:
            fcraGate.reason === "FCRA_REQUIRED"
              ? "This NGO is not registered to accept foreign contributions. " +
                "FCRA registration must be ACTIVE before international donors can contribute."
              : "Please complete your donor category declaration before donating.",
          fcraStatus: fcraGate.reason === "FCRA_REQUIRED" ? fcraGate.fcraStatus : undefined,
        },
        { status: 403 }
      );
    }
    // ──────────────────────────────────────────────────────────────────────────

    const isMock = !process.env.RAZORPAY_KEY_ID || 
                   process.env.RAZORPAY_KEY_ID.includes("xxxxxxxxxxxx") || 
                   process.env.RAZORPAY_KEY_ID === "";

    if (isMock) {
      console.log(`[MOCK CHECKOUT] Initiating mock donation order for project ${projectId} amount ${amount}`);
      const mockOrderId = `order_mock_${Date.now()}`;
      
      // Calculate compliance snapshot
      let complianceSnapshot: Record<string, unknown> | null = null;
      try {
        const [ngoComp, hasImpactProof] = await Promise.all([
          prisma.nGOCompliance.findUnique({
            where: { ngoId: project.ngoId },
          }),
          (async () => {
            const { hasVerifiedImpactProof } = await import("@/lib/ngo-compliance");
            return hasVerifiedImpactProof(project.ngoId);
          })(),
        ]);
        const { computeCompliance, deriveFcraStatus } = await import("@/lib/ngo-compliance");
        const compliance = computeCompliance(ngoComp, hasImpactProof);
        const liveFcra =
          ngoComp?.fcraExpiryDate &&
          ["ACTIVE", "EXPIRING_SOON", "EXPIRED"].includes(ngoComp.fcraStatus)
            ? deriveFcraStatus(ngoComp.fcraExpiryDate) ?? ngoComp.fcraStatus
            : ngoComp?.fcraStatus ?? "NONE";

        complianceSnapshot = {
          version: 1,
          capturedAt: new Date().toISOString(),
          panStatus: freshUser?.donorCategory === "INDIAN_IN_INDIA" ? "VERIFIED" : "MOCK", 
          panVerifiedVia: "MOCK",
          donorCategory: freshUser?.donorCategory || "INDIAN_IN_INDIA",
          nriSourceDeclaration: freshUser?.nriSourceDeclaration || null,
          ngoFcraStatus: liveFcra,
          ngoComplianceScore: compliance.score,
          ngoHealthScore: 80,
        };
      } catch (snapErr) {
        console.error(`[MOCK CHECKOUT] FAILED to build compliance snapshot:`, snapErr);
      }

      // Execute transaction to update raisedAmount, totalDonated, milestone status, and create Donation
      const donation = await prisma.$transaction(async (tx) => {
        // Create Donation in SUCCESS state
        const d = await tx.donation.create({
          data: {
            status: "SUCCESS",
            razorpayOrderId: mockOrderId,
            razorpayPaymentId: `pay_mock_${Date.now()}`,
            donorId: session.user.id,
            projectId,
            amount,
            milestoneIds,
            ...(complianceSnapshot ? { complianceSnapshot: complianceSnapshot as any } : {}),
          },
          include: {
            donor: true,
            project: { include: { ngo: true } },
          },
        });

        // Update Project raised amount
        await tx.project.update({
          where: { id: projectId },
          data: {
            raisedAmount: {
              increment: amount,
            },
          },
        });

        // Update Donor totalDonated
        await tx.user.update({
          where: { id: session.user.id },
          data: {
            totalDonated: {
              increment: amount,
            },
          },
        });

        // If milestones, move PENDING -> IN_PROGRESS
        if (milestoneIds && milestoneIds.length > 0) {
          await tx.milestone.updateMany({
            where: {
              id: { in: milestoneIds },
              status: "PENDING",
            },
            data: { status: "IN_PROGRESS" },
          });
        }

        return d;
      });

      // Post-resolve actions (impact feed subscription, 80G receipt)
      try {
        const { ensureImpactSubscription } = await import("@/lib/impact-events");
        await ensureImpactSubscription(donation.donorId, donation.projectId);
      } catch (subErr) {
        console.error("[MOCK CHECKOUT] Failed to create impact subscription:", subErr);
      }

      try {
        const { evaluateReceiptEligibility, issueTaxReceipt, queueReceiptClaim } = await import("@/lib/tax-receipt");
        const { eligible } = evaluateReceiptEligibility(donation.donor);
        if (eligible) {
          await issueTaxReceipt(donation.id);
        } else {
          await queueReceiptClaim(donation);
        }
      } catch (receiptErr) {
        console.error("[MOCK CHECKOUT] Failed to generate/queue tax receipt:", receiptErr);
      }

      return NextResponse.json({
        orderId: mockOrderId,
        amount,
        currency: "INR",
        donationId: donation.id,
        isMock: true,
      });
    }

    // Create Razorpay order
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
    });

    // Create Donation record in DB
    const donation = await prisma.donation.create({
      data: {
        status: "PENDING",
        razorpayOrderId: order.id,
        donorId: session.user.id,
        projectId,
        amount,
        milestoneIds,
      },
    });

    return NextResponse.json({
      orderId: order.id,
      // razorpayOrderId/keyId/donorName/donorEmail: DonateModal.tsx reads
      // these exact field names to construct the Razorpay Checkout options —
      // this response previously didn't include them at all, so the widget
      // could never actually open even when order creation succeeded.
      razorpayOrderId: order.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      donorName: session.user.name,
      donorEmail: session.user.email,
      amount,
      currency: "INR",
      donationId: donation.id,
    });
  } catch (error) {
    const err = error as Error;
    // Log the real error server-side, but never forward raw internal/SDK
    // error text (e.g. Razorpay credential errors) to the donor.
    console.error("Error creating donation order:", err);
    return NextResponse.json(
      { error: "We couldn't start your donation right now. Please try again in a moment." },
      { status: 500 }
    );
  }
}
