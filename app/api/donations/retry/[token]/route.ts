import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;

    if (!token) {
      return NextResponse.json(
        { error: "Invalid or expired retry link. Please make a new donation." },
        { status: 400 }
      );
    }

    // Find the original failed donation
    const donation = await prisma.donation.findFirst({
      where: {
        retryToken: token,
        retryTokenExpiresAt: { gt: new Date() },
        status: "FAILED",
      },
      include: {
        project: { select: { id: true, title: true, status: true } },
        donor: { select: { id: true, email: true, name: true } },
      },
    });

    if (!donation) {
      return NextResponse.json(
        { error: "Invalid or expired retry link. Please make a new donation." },
        { status: 400 }
      );
    }

    // Verify the project is still ACTIVE
    if (donation.project.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "This project is no longer accepting donations." },
        { status: 400 }
      );
    }

    // Create a new Razorpay order for the same amount
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Razorpay = require("razorpay");
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(Number(donation.amount) * 100), // paise
      currency: "INR",
      receipt: `retry_${donation.id}_${Date.now()}`,
    });

    // Create a NEW Donation row for this retry attempt
    const newDonation = await prisma.donation.create({
      data: {
        donorId: donation.donorId,
        projectId: donation.projectId,
        amount: donation.amount,
        razorpayOrderId: order.id,
        status: "PENDING",
        retryCount: 0,
      },
    });

    // Invalidate the retry token on the original donation
    await prisma.donation.update({
      where: { id: donation.id },
      data: {
        retryToken: null,
        retryTokenExpiresAt: null,
      },
    });

    return NextResponse.json({
      orderId: order.id,
      amount: Number(donation.amount),
      currency: "INR",
      donationId: newDonation.id,
      donorName: donation.donor.name,
      donorEmail: donation.donor.email,
      projectTitle: donation.project.title,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error in donation retry endpoint:", err);
    return NextResponse.json(
      { error: err.message || "An unexpected error occurred while setting up retry." },
      { status: 500 }
    );
  }
}
