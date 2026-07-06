import prisma from "@/lib/prisma";
import crypto from "crypto";
import { checkFcraGate } from "@/lib/fcra-gate";
import { sendDonationApprovalEmail, sendDonationSuccessEmail } from "@/lib/email";

export interface InitiatePaymentParams {
  donorId: string;
  projectId: string;
  amount: number;
  milestoneIds?: string[];
}

export interface ResolvePaymentResponse {
  success: boolean;
  reason?: string;
  donation?: any;
}

/**
 * MOCK EMAIL-APPROVAL PAYMENT GATEWAY SERVICE
 * 
 * To replace with real Razorpay:
 * 1. Modify initiatePayment to call razorpay.orders.create, write order details into the Donation record,
 *    and omit sending the approval email.
 * 2. Point Razorpay webhooks to an endpoint that calls approvePayment/rejectPayment based on the webhook event.
 */

export async function initiatePayment({
  donorId,
  projectId,
  amount,
  milestoneIds = [],
}: InitiatePaymentParams) {
  // 1. Fetch donor
  const donor = await prisma.user.findUnique({
    where: { id: donorId },
  });
  if (!donor) throw new Error("Donor not found");

  // 2. Fetch project + NGO details
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { ngo: { select: { isSuspended: true, orgName: true, id: true } } },
  });
  if (!project) throw new Error("Project not found");
  if (project.ngo?.isSuspended) {
    throw new Error("NGO has been suspended and cannot receive donations at this time.");
  }
  if (project.status !== "ACTIVE") {
    throw new Error("Project is not currently accepting donations.");
  }

  // 3. FCRA Gate Check
  const ngoCompliance = await prisma.nGOCompliance.findUnique({
    where: { ngoId: project.ngoId },
    select: { fcraStatus: true, fcraExpiryDate: true },
  });

  const fcraGateResult = checkFcraGate({
    donorCategory: donor.donorCategory,
    nriSourceDeclaration: donor.nriSourceDeclaration,
    ngoFcraExpiryDate: ngoCompliance?.fcraExpiryDate,
    ngoFcraStatus: ngoCompliance?.fcraStatus ?? "NONE",
  });

  if (!fcraGateResult.allowed) {
    if (fcraGateResult.reason === "FCRA_REQUIRED") {
      throw new Error(
        "This NGO is not registered to accept foreign contributions. " +
        "FCRA registration must be ACTIVE before international donors can contribute."
      );
    } else {
      throw new Error("Please complete your donor category declaration before donating.");
    }
  }

  // 4. Validate milestoneIds if provided
  if (milestoneIds.length > 0) {
    const validMilestones = await prisma.milestone.findMany({
      where: {
        id: { in: milestoneIds },
        projectId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      select: { id: true },
    });

    if (validMilestones.length !== milestoneIds.length) {
      throw new Error("One or more selected milestones are invalid or closed.");
    }
  }

  // 5. Generate secure approval token
  const rawToken = crypto.randomBytes(32).toString("hex");
  const approvalTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const EXPIRY_MINUTES = 30;
  const tokenExpiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  // 6. Create donation record with PENDING_APPROVAL status
  const donation = await prisma.donation.create({
    data: {
      donorId,
      projectId,
      amount,
      status: "PENDING_APPROVAL",
      razorpayOrderId: `mock_order_${crypto.randomBytes(8).toString("hex")}`,
      milestoneIds,
      approvalTokenHash,
      tokenExpiresAt,
    },
  });

  // 7. Send approval email
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const approveUrl = `${baseUrl}/api/donations/approve/${donation.id}/${rawToken}`;
  const cancelUrl = `${baseUrl}/api/donations/reject/${donation.id}/${rawToken}`;

  console.log(`[MOCK PAYMENT] Initiated donation ${donation.id}. Sending approval email...`);
  await sendDonationApprovalEmail({
    to: donor.email,
    donorName: donor.name || "Anonymous",
    ngoName: project.ngo.orgName,
    projectTitle: project.title,
    amount,
    approveUrl,
    cancelUrl,
    expiryMinutes: EXPIRY_MINUTES,
  });

  return { success: true, donationId: donation.id };
}

export async function approvePayment(
  donationId: string,
  rawToken: string
): Promise<ResolvePaymentResponse> {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  // Fetch donation first
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    include: {
      donor: true,
      project: { include: { ngo: true } },
    },
  });

  if (!donation) {
    return { success: false, reason: "DONATION_NOT_FOUND" };
  }

  if (donation.status !== "PENDING_APPROVAL") {
    return { success: false, reason: "ALREADY_PROCESSED" };
  }

  if (donation.approvalTokenHash !== tokenHash) {
    return { success: false, reason: "INVALID_TOKEN" };
  }

  if (donation.tokenExpiresAt && donation.tokenExpiresAt < new Date()) {
    // Lazily mark EXPIRED
    await prisma.donation.update({
      where: { id: donationId },
      data: {
        status: "EXPIRED",
        approvalTokenHash: null,
        tokenExpiresAt: null,
      },
    });
    return { success: false, reason: "TOKEN_EXPIRED" };
  }

  // 1. Build compliance snapshot
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
    console.error(`[Mock Payment] FAILED to build compliance snapshot for donation ${donation.id}:`, snapErr);
  }

  // 2. Perform database updates in a transaction
  let updatedDonation: any = null;
  try {
    updatedDonation = await prisma.$transaction(async (tx) => {
      // Update Donation record
      const d = await tx.donation.update({
        where: { id: donationId },
        data: {
          status: "SUCCESS",
          resolvedAt: new Date(),
          razorpayPaymentId: `mock_pay_${crypto.randomBytes(8).toString("hex")}`,
          approvalTokenHash: null,
          tokenExpiresAt: null,
          ...(complianceSnapshot ? { complianceSnapshot: complianceSnapshot as any } : {}),
        },
        include: {
          donor: true,
          project: { include: { ngo: true } },
        },
      });

      // Update Project raised amount
      await tx.project.update({
        where: { id: donation.projectId },
        data: {
          raisedAmount: {
            increment: donation.amount,
          },
        },
      });

      // Update Donor totalDonated
      await tx.user.update({
        where: { id: donation.donorId },
        data: {
          totalDonated: {
            increment: donation.amount,
          },
        },
      });

      // If milestoneIds, move them PENDING -> IN_PROGRESS
      if (donation.milestoneIds && donation.milestoneIds.length > 0) {
        await tx.milestone.updateMany({
          where: {
            id: { in: donation.milestoneIds },
            status: "PENDING",
          },
          data: { status: "IN_PROGRESS" },
        });
      }

      return d;
    });
  } catch (txErr) {
    console.error("[Mock Payment] Transaction failed:", txErr);
    return { success: false, reason: "TRANSACTION_FAILED" };
  }

  // 3. Post-resolve actions (impact feed subscription, 80G receipt, success email)
  try {
    const { ensureImpactSubscription } = await import("@/lib/impact-events");
    await ensureImpactSubscription(donation.donorId, donation.projectId);
  } catch (subErr) {
    console.error("[Mock Payment] Failed to create impact subscription:", subErr);
  }

  // Issue 80G tax receipt
  let receiptUrl: string | null = null;
  try {
    const { evaluateReceiptEligibility, issueTaxReceipt, queueReceiptClaim } = await import("@/lib/tax-receipt");
    const { eligible } = evaluateReceiptEligibility(updatedDonation.donor);
    if (eligible) {
      const receipt = await issueTaxReceipt(updatedDonation.id);
      receiptUrl = receipt?.pdfUrl || null;
    } else {
      await queueReceiptClaim(updatedDonation);
    }
  } catch (receiptErr) {
    console.error("[Mock Payment] Failed to generate/queue tax receipt:", receiptErr);
  }

  // Send success email
  console.log(`[MOCK PAYMENT] Donation ${donationId} approved. Sending confirmation email...`);
  await sendDonationSuccessEmail({
    to: updatedDonation.donor.email,
    donorName: updatedDonation.donor.name || "Anonymous",
    ngoName: updatedDonation.project.ngo.orgName,
    projectTitle: updatedDonation.project.title,
    amount: Number(donation.amount),
    receiptUrl,
  });

  return { success: true, donation: updatedDonation };
}

export async function rejectPayment(
  donationId: string,
  rawToken: string
): Promise<ResolvePaymentResponse> {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
  });

  if (!donation) {
    return { success: false, reason: "DONATION_NOT_FOUND" };
  }

  if (donation.status !== "PENDING_APPROVAL") {
    return { success: false, reason: "ALREADY_PROCESSED" };
  }

  if (donation.approvalTokenHash !== tokenHash) {
    return { success: false, reason: "INVALID_TOKEN" };
  }

  // Cancel donation
  const updatedDonation = await prisma.donation.update({
    where: { id: donationId },
    data: {
      status: "FAILED",
      resolvedAt: new Date(),
      approvalTokenHash: null,
      tokenExpiresAt: null,
    },
  });

  console.log(`[MOCK PAYMENT] Donation ${donationId} rejected.`);
  return { success: true, donation: updatedDonation };
}
