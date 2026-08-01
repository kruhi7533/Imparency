import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { sendPaymentRetryEmail } from "@/lib/email";
import { generateRetryToken, getRetryDelay } from "@/lib/retry-utils";
import { evaluateReceiptEligibility, issueTaxReceipt, queueReceiptClaim } from "@/lib/tax-receipt";
import { captureError } from "@/lib/observability";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") ?? "";

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
      return NextResponse.json({ error: "Configuration error" }, { status: 500 });
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.warn("Invalid Razorpay webhook signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const eventName = event.event;

    if (eventName === "payment.captured") {
      const paymentEntity = event.payload.payment.entity;
      const order_id = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      // Fetch full data needed for receipt
      const donation = await prisma.donation.findFirst({
        where: { razorpayOrderId: order_id },
        include: {
          donor: true,
          project: { include: { ngo: true } },
        },
      });

      if (!donation) {
        console.warn(`Donation with order_id ${order_id} not found.`);
        return NextResponse.json({ received: true }, { status: 200 });
      }

      // If already successfully processed, return 200
      if (donation.status === "SUCCESS") {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      // ── Compliance snapshot (IMMUTABLE) ────────────────────────────────────
      // Point-in-time record of the donor's and NGO's compliance state at the
      // moment the payment was confirmed. Written once, inside the same
      // transaction that marks the donation SUCCESS; never modified afterwards
      // (corrections become new audit events). Audits read this — not live state.
      let complianceSnapshot: Record<string, unknown> | null = null;
      try {
        const [ngoCompliance, hasImpactProof] = await Promise.all([
          prisma.nGOCompliance.findUnique({
            where: { ngoId: donation.project.ngoId },
          }),
          (async () => {
            const { hasVerifiedImpactProof } = await import("@/lib/ngo-compliance");
            return hasVerifiedImpactProof(donation.project.ngoId);
          })(),
        ]);
        const { computeCompliance, deriveFcraStatus } = await import("@/lib/ngo-compliance");
        const compliance = computeCompliance(ngoCompliance, hasImpactProof);
        const liveFcra =
          ngoCompliance?.fcraExpiryDate &&
          ["ACTIVE", "EXPIRING_SOON", "EXPIRED"].includes(ngoCompliance.fcraStatus)
            ? deriveFcraStatus(ngoCompliance.fcraExpiryDate) ?? ngoCompliance.fcraStatus
            : ngoCompliance?.fcraStatus ?? "NONE";

        complianceSnapshot = {
          version: 1,
          capturedAt: new Date().toISOString(),
          panStatus: donation.donor.panStatus,
          panVerifiedVia: donation.donor.panVerifiedVia,
          donorCategory: donation.donor.donorCategory,
          nriSourceDeclaration: donation.donor.nriSourceDeclaration,
          ngoFcraStatus: liveFcra,
          ngoComplianceScore: compliance.score,
          ngoHealthScore:
            donation.project.ngo.healthScore != null
              ? Number(donation.project.ngo.healthScore)
              : null,
        };
      } catch (snapErr) {
        // Never block payment confirmation on snapshot assembly — but capture it,
        // because a missing snapshot is permanently unreconstructable.
        captureError(snapErr, {
          scope: "donations/webhook",
          operation: "build_compliance_snapshot",
          entityType: "DONATION",
          entityId: donation.id,
        });
      }

      // Update database: status: SUCCESS, increment project.raisedAmount, increment user.totalDonated
      await prisma.$transaction([
        prisma.donation.update({
          where: { id: donation.id },
          data: {
            status: "SUCCESS",
            razorpayPaymentId: paymentId,
            ...(complianceSnapshot ? { complianceSnapshot: complianceSnapshot as any } : {}),
          },
        }),
        prisma.project.update({
          where: { id: donation.projectId },
          data: {
            raisedAmount: { increment: donation.amount },
          },
        }),
        prisma.user.update({
          where: { id: donation.donorId },
          data: {
            totalDonated: { increment: donation.amount },
          },
        }),
      ]);

      // If milestoneIds present: move PENDING milestones -> IN_PROGRESS
      if (donation.milestoneIds && donation.milestoneIds.length > 0) {
        await prisma.milestone.updateMany({
          where: {
            id: { in: donation.milestoneIds },
            status: "PENDING",
          },
          data: {
            status: "IN_PROGRESS",
          },
        });
      }

      // Fetch the updated donation to get the accurate updated fields or timestamps
      const updatedDonation = await prisma.donation.findUnique({
        where: { id: donation.id },
        include: {
          donor: true,
          project: { include: { ngo: true } },
        },
      });

      if (!updatedDonation) {
        throw new Error("Failed to retrieve updated donation record");
      }

      // Auto-subscribe the donor to this project's impact feed — donating IS
      // the expression of interest (opt-out model, idempotent upsert).
      try {
        const { ensureImpactSubscription } = await import("@/lib/impact-events");
        await ensureImpactSubscription(donation.donorId, donation.projectId);
      } catch (subErr) {
        console.error("Failed to create impact subscription:", subErr);
      }

      // 80G receipt is only issued once the donor's PAN is verified. If it's not
      // yet verified, withhold the receipt and nudge the donor to verify + claim.
      const { eligible } = evaluateReceiptEligibility(updatedDonation.donor);
      if (eligible) {
        await issueTaxReceipt(updatedDonation.id);
      } else {
        await queueReceiptClaim(updatedDonation);
      }

      // NOTE: Replace with Inngest or Vercel Cron in production.
      const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;

      setTimeout(async () => {
        try {
          // Find the most recent ImpactReport for this donation
          const report = await prisma.impactReport.findFirst({
            where: { donationId: donation.id },
            orderBy: { sentAt: "desc" }
          });

          if (!report) {
            // No impact report yet — re-engagement will be triggered
            // by the Gemini impact agent in Phase 4 instead.
            console.log(`[ReEngagement] No impact report for donationId=${donation.id}, skipping.`);
            return;
          }

          // Call re-engagement API internally
          const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
          await fetch(`${baseUrl}/api/engagement/re-engage`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // Internal call — bypass auth with a server secret header
              "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
            },
            body: JSON.stringify({ reportId: report.id, donorId: donation.donorId }),
          });
        } catch (err) {
          console.error("[ReEngagement Scheduler Error]", err);
        }
      }, FORTY_EIGHT_HOURS);
    } else if (eventName === "payment.failed") {
      const paymentEntity = event.payload.payment.entity;
      const orderId = paymentEntity.order_id;

      const donation = await prisma.donation.findFirst({
        where: { razorpayOrderId: orderId },
        include: {
          donor: { select: { id: true, email: true, name: true } },
          project: { select: { title: true } },
        },
      });

      if (!donation) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const newRetryCount = donation.retryCount + 1;
      const delay = getRetryDelay(donation.retryCount);

      if (delay !== -1) {
        // Still have retries left — schedule a retry attempt
        // Update retryCount and lastFailedAt, keep status as PENDING
        // so the webhook can match it again on the next attempt
        await prisma.donation.update({
          where: { id: donation.id },
          data: {
            retryCount: newRetryCount,
            lastFailedAt: new Date(),
            // Keep status PENDING — a retry is coming
          },
        });

        // NOTE: setTimeout is used here for simplicity in development.
        // In production, replace with a proper job queue such as
        // Inngest, BullMQ, or Vercel Cron to guarantee delayed execution.
        setTimeout(async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Razorpay = require("razorpay");
            const razorpay = new Razorpay({
              key_id: process.env.RAZORPAY_KEY_ID,
              key_secret: process.env.RAZORPAY_KEY_SECRET,
            });
            // Fetch the order to confirm it's still open
            const order = await razorpay.orders.fetch(orderId);
            if (order.status === "paid") return; // already succeeded somehow
            // No direct Razorpay API to "retry" — the retry happens
            // when the donor re-opens checkout. So log the intent only.
            console.log(`[Retry Scheduled] donationId=${donation.id} attempt=${newRetryCount} delay=${delay}ms`);
          } catch (err) {
            console.error("[Retry Scheduler Error]", err);
          }
        }, delay);

      } else {
        // Retries exhausted — mark FAILED, generate token, send email
        const retryToken = generateRetryToken();
        const retryTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        await prisma.donation.update({
          where: { id: donation.id },
          data: {
            status: "FAILED",
            retryCount: newRetryCount,
            lastFailedAt: new Date(),
            retryToken,
            retryTokenExpiresAt,
          },
        });

        const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
        const retryUrl = `${baseUrl}/donor/retry/${retryToken}`;

        await sendPaymentRetryEmail(
          donation.donor.email,
          donation.donor.name,
          donation.project.title,
          Number(donation.amount),
          retryUrl
        );
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    const err = error as Error;
    // Returning 200 stops Razorpay retrying, so anything that lands here is a
    // payment we took and may never have recorded. There is no second chance
    // and no automatic recovery — this is the most important error in the app.
    captureError(
      err,
      { scope: "donations/webhook", operation: "process_webhook" },
      "fatal"
    );
    return NextResponse.json({ error: err.message, fallback: true }, { status: 200 });
  }
}
