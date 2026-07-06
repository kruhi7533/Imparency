import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function POST(request: Request) {
  try {
    // 1. Auth guard
    const { authorized, response, session } = await verifySessionRole("DONOR");
    if (!authorized) return response;

    // 2. Parse body
    const body = await request.json();
    const { projectId, amount, milestoneIds = [], donorCategory } = body;

    // 3. Validate amount
    if (!amount || isNaN(amount) || amount < 100) {
      return NextResponse.json(
        { error: "Minimum donation amount is Rs.100" },
        { status: 400 }
      );
    }

    // 4. Fetch project — verify it exists and is ACTIVE
    const project = await prisma.project.findUnique({
      where: { id: projectId, isDeleted: false },
      select: {
        id: true,
        title: true,
        status: true,
        ngo: { select: { orgName: true } },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    if (project.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "This project is not currently accepting donations" },
        { status: 400 }
      );
    }

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
