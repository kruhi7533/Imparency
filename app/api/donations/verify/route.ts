import crypto from "crypto";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, donationId } =
      await request.json();

    // Verify signature client-side confirmation
    // Format: orderId + "|" + paymentId
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(body)
      .digest("hex");

    const isValid = expectedSignature === razorpaySignature;

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Payment verification failed" },
        { status: 400 }
      );
    }

    // Mark as SUCCESS immediately (webhook will also do this —
    // whichever arrives first wins, idempotency check handles duplicates)
    await prisma.donation.update({
      where: { id: donationId },
      data: {
        status: "SUCCESS",
        razorpayPaymentId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const err = error as Error;
    console.error("Error verifying payment signature:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to verify signature" },
      { status: 500 }
    );
  }
}
