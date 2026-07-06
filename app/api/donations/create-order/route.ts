import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import Razorpay from "razorpay";
import { verifySessionRole } from "@/lib/auth-guards";
import { Role } from "@prisma/client";
import { checkFcraGate } from "@/lib/fcra-gate";

export async function POST(request: Request) {
  try {
    // 1. Auth guard
    const auth = await verifySessionRole(Role.DONOR);
    if (!auth.authorized) return auth.response;
    const session = auth.session;

    // 2. Parse body
    const body = await request.json();
    const { projectId, amount, milestoneIds = [] } = body;

    // 3. Validate amount
    if (!amount || isNaN(amount) || amount < 100) {
      return NextResponse.json(
        { error: "Minimum donation amount is Rs.100" },
        { status: 400 }
      );
    }

    // 4. Fetch project — verify it exists and is ACTIVE, including NGO status
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

    // 5. Validate milestoneIds if provided
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
        return NextResponse.json(
          { error: "One or more selected milestones are invalid or not accepting donations" },
          { status: 400 }
        );
      }
    }

    // 6. Create Razorpay order
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });

    // amount in paise (1 rupee = 100 paise)
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: {
        projectId,
        projectTitle: project.title,
        ngoName: project.ngo.orgName,
        donorId: session.user.id,
      },
    });

    // 7. Create PENDING Donation row in DB
    const donation = await prisma.donation.create({
      data: {
        donorId: session.user.id,
        projectId,
        amount,
        razorpayOrderId: razorpayOrder.id,
        status: "PENDING",
        milestoneIds,
      },
    });

    // 8. Return order details to client
    return NextResponse.json({
      orderId: razorpayOrder.id,
      amount: Math.round(amount * 100), // paise — Razorpay SDK expects paise
      currency: "INR",
      donationId: donation.id,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      projectTitle: project.title,
      ngoName: project.ngo.orgName,
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
