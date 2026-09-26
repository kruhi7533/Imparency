import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyRazorpaySignature } from "@/lib/razorpay-webhook";

// Reuses the same RAZORPAY_WEBHOOK_SECRET as /api/donations/webhook — this
// route needs its own webhook entry in the Razorpay dashboard pointing here,
// but both can share one secret since they belong to the same account.
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") ?? "";

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is not configured");
      return NextResponse.json({ error: "Configuration error" }, { status: 500 });
    }

    if (!verifyRazorpaySignature(rawBody, signature, secret)) {
      console.warn("Invalid Razorpay webhook signature (crisis)");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const eventName = event.event;

    if (eventName === "payment.captured") {
      const paymentEntity = event.payload.payment.entity;
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      const donation = await prisma.crisisDonation.findFirst({
        where: { razorpayOrderId: orderId },
        include: { donor: true },
      });

      if (!donation) {
        console.warn(`Crisis donation with order_id ${orderId} not found.`);
        return NextResponse.json({ received: true }, { status: 200 });
      }
      if (donation.status === "SUCCESS") {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const isFirstTimeDonor =
        (await prisma.crisisDonation.count({
          where: { crisisEventId: donation.crisisEventId, donorId: donation.donorId, status: "SUCCESS" },
        })) === 0;

      let complianceSnapshot: Record<string, unknown> | null = null;
      try {
        complianceSnapshot = {
          version: 1,
          capturedAt: new Date().toISOString(),
          panStatus: donation.donor.panStatus,
          panVerifiedVia: donation.donor.panVerifiedVia,
          donorCategory: donation.donor.donorCategory,
          nriSourceDeclaration: donation.donor.nriSourceDeclaration,
        };
      } catch (snapErr) {
        console.error(`[crisis-webhook] FAILED to build compliance snapshot for donation ${donation.id}:`, snapErr);
      }

      await prisma.$transaction(async (tx) => {
        await tx.crisisDonation.update({
          where: { id: donation.id },
          data: {
            status: "SUCCESS",
            razorpayPaymentId: paymentId,
            ...(complianceSnapshot ? { complianceSnapshot: complianceSnapshot as any } : {}),
          },
        });

        await tx.crisisEvent.update({
          where: { id: donation.crisisEventId },
          data: {
            totalRaised: { increment: donation.amount },
            ...(isFirstTimeDonor ? { totalDonors: { increment: 1 } } : {}),
          },
        });

        if (donation.targetType === "NGO_CAMPAIGN" && donation.campaignProjectId) {
          await tx.project.update({
            where: { id: donation.campaignProjectId },
            data: { raisedAmount: { increment: donation.amount } },
          });
        }
        if (donation.targetType === "INITIATIVE" && donation.initiativeId) {
          await tx.reliefInitiative.update({
            where: { id: donation.initiativeId },
            data: { raisedAmount: { increment: donation.amount }, totalDonors: { increment: 1 } },
          });
        }

        await tx.user.update({
          where: { id: donation.donorId },
          data: { totalDonated: { increment: donation.amount } },
        });
      });

      // NOT wired to 80G receipt issuance yet, deliberately. issueTaxReceipt()/
      // queueReceiptClaim() are hard-coupled to Donation→Project→NGOProfile
      // (they read donation.project.ngo.* directly) and can't be reused as-is:
      // - NGO_CAMPAIGN donations DO have a real 80G-eligible NGO and could get
      //   one, but need a CrisisDonation-aware variant of these functions.
      // - CRISIS_DIRECT donations have no NGO at all (platform-held fund).
      // - INITIATIVE donations go to an individual/informal group with no 80G
      //   registration — issuing a receipt there would be legally incorrect,
      //   not just a missing feature.
      // Tracking as an explicit gap rather than guessing at receipt logic here.
    } else if (eventName === "payment.failed") {
      const paymentEntity = event.payload.payment.entity;
      const orderId = paymentEntity.order_id;

      const donation = await prisma.crisisDonation.findFirst({ where: { razorpayOrderId: orderId } });
      if (donation && donation.status === "PENDING") {
        await prisma.crisisDonation.update({ where: { id: donation.id }, data: { status: "FAILED" } });
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: any) {
    console.error("Crisis webhook error:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
