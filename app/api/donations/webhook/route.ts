import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { getIndianFinancialYear } from "@/lib/finance-utils";
import { generateReceiptBuffer } from "@/lib/receipt-generator";
import { uploadFile } from "@/lib/storage";
import { sendReceiptEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");

    if (!signature) {
      console.warn("Webhook attempt missing signature header");
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "mockwebhooksecret";

    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (signature !== expectedSignature) {
      console.warn("Invalid webhook signature received");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event;

    // We only process payment capture or order paid events
    if (event !== "payment.captured" && event !== "order.paid") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Extract entity details
    const paymentEntity = payload.payload?.payment?.entity;
    const orderEntity = payload.payload?.order?.entity;

    const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
    const razorpayPaymentId = paymentEntity?.id;

    if (!razorpayOrderId) {
      return NextResponse.json({ error: "Order ID not found in payload" }, { status: 400 });
    }

    // Check for duplicate webhook delivery using payment ID (idempotency check)
    if (razorpayPaymentId) {
      const duplicateDonation = await prisma.donation.findFirst({
        where: { razorpayPaymentId, status: "SUCCESS" },
      });
      if (duplicateDonation) {
        return NextResponse.json({ duplicate: true }, { status: 200 });
      }
    }

    // Find the pending donation with full relations
    const donation = await prisma.donation.findFirst({
      where: { razorpayOrderId },
      include: {
        donor: true,
        project: {
          include: {
            ngo: true,
          },
        },
      },
    });

    if (!donation) {
      return NextResponse.json({ error: "Associated donation record not found" }, { status: 404 });
    }

    // If already successful, return OK (idempotency check)
    if (donation.status === "SUCCESS") {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Update Donation Status
    await prisma.donation.update({
      where: { id: donation.id },
      data: {
        status: "SUCCESS",
        razorpayPaymentId: razorpayPaymentId || null,
      },
    });

    // Increment user totalDonated
    await prisma.user.update({
      where: { id: donation.donorId },
      data: {
        totalDonated: {
          increment: donation.amount,
        },
      },
    });

    // Calculate Financial Year & generate Receipt Number
    const now = new Date();
    const fy = getIndianFinancialYear(now);
    const shortYear = fy.split("-")[1]; // "2026-27" -> "27"

    // Transaction sequence query
    const count = await prisma.taxReceipt.count({
      where: { financialYear: fy },
    });
    const seq = String(count + 1).padStart(5, "0");
    const receiptNumber = `IB-FY${shortYear}-${seq}`;

    // Generate PDF buffer using react-pdf/renderer
    const pdfBuffer = await generateReceiptBuffer(
      {
        id: donation.id,
        amount: Number(donation.amount),
        createdAt: donation.createdAt,
        razorpayPaymentId: razorpayPaymentId || null,
      },
      {
        receiptNumber,
        financialYear: fy,
        issuedAt: now,
      },
      donation.donor,
      donation.project.ngo,
      donation.project
    );

    // Upload PDF using file storage adapter
    const pdfUrl = await uploadFile(pdfBuffer, `${receiptNumber}.pdf`, `receipts/${donation.id}`);

    // Write TaxReceipt database record
    await prisma.taxReceipt.create({
      data: {
        donationId: donation.id,
        receiptNumber,
        financialYear: fy,
        pdfUrl,
        issuedAt: now,
      },
    });

    // Update the donation record with receiptUrl
    await prisma.donation.update({
      where: { id: donation.id },
      data: {
        receiptUrl: pdfUrl,
      },
    });

    // Send confirmation email via Resend
    try {
      await sendReceiptEmail(
        donation.donor.email,
        donation.donor.name,
        receiptNumber,
        pdfUrl,
        Number(donation.amount),
        donation.project.title,
        pdfBuffer
      );
    } catch (emailErr) {
      console.error("Failed to send receipt email:", emailErr);
    }

    console.log(`Donation ${donation.id} resolved successfully. Receipt issued: ${receiptNumber}`);

    // Trigger push notification to NGO
    try {
      const { triggerNewDonationReceived } = require("@/lib/notification-triggers");
      await triggerNewDonationReceived(donation.id);
    } catch (triggerErr) {
      console.error("Failed to trigger new donation notification:", triggerErr);
    }

    // Recalculate NGO health score
    try {
      const { recalculateNGOHealthScore } = require("@/lib/ngo-health");
      await recalculateNGOHealthScore(donation.project.ngoId);
    } catch (healthErr) {
      console.error("Failed to recalculate health score on webhook donation:", healthErr);
    }

    // Check donation rate fraud alerts
    try {
      const { checkDonationRate } = require("@/lib/fraud-alerts");
      await checkDonationRate(donation.donorId);
    } catch (fraudErr) {
      console.error("Failed to run donation rate fraud check:", fraudErr);
    }

    return NextResponse.json({ success: true, receiptNumber, pdfUrl }, { status: 200 });

  } catch (err: any) {
    console.error("Webhook processing error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
