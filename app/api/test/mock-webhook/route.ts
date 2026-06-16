import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Disable in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { donationId, amount } = body;

    if (!donationId) {
      return NextResponse.json({ error: "donationId is required" }, { status: 400 });
    }

    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
    });

    if (!donation) {
      return NextResponse.json({ error: "Donation not found" }, { status: 404 });
    }

    const finalAmount = amount || Number(donation.amount);
    const mockPaymentId = `pay_${crypto.randomBytes(8).toString("hex")}`;

    // Construct mock payload matching Razorpay schema
    const webhookPayload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: mockPaymentId,
            entity: "payment",
            amount: Math.round(finalAmount * 100),
            currency: "INR",
            status: "captured",
            order_id: donation.razorpayOrderId,
            invoice_id: null,
            international: false,
            method: "upi",
            amount_refunded: 0,
            refund_status: null,
            captured: true,
            description: "Mock payment capture",
          },
        },
      },
    };

    const payloadString = JSON.stringify(webhookPayload);
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "mockwebhooksecret";

    // Generate valid HMAC signature
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(payloadString)
      .digest("hex");

    // Construct absolute URL for the webhook route
    const webhookUrl = new URL("/api/donations/webhook", request.url).toString();

    // Call webhook endpoint
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-razorpay-signature": signature,
      },
      body: payloadString,
    });

    const result = await response.json();

    return NextResponse.json({
      status: response.status,
      webhookUrl,
      payload: webhookPayload,
      signature,
      responseBody: result,
    });

  } catch (err: any) {
    console.error("Mock webhook tester error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
