import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import Razorpay from "razorpay";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkFcraGate } from "@/lib/fcra-gate";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Only donors can make donations" }, { status: 403 });
    }

    const body = await request.json();
    const { projectId, amount } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    if (!amount || typeof amount !== "number" || amount < 100) {
      return NextResponse.json({ error: "Amount must be a number and at least Rs. 100" }, { status: 400 });
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
      },
    });

    return NextResponse.json({
      orderId: order.id,
      amount,
      currency: "INR",
      donationId: donation.id,
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error creating donation order:", err);
    return NextResponse.json(
      { error: err.message || "Failed to create donation order" },
      { status: 500 }
    );
  }
}
