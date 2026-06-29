import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

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
    const { projectId, amount, milestoneIds = [] } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    if (!amount || typeof amount !== "number" || amount < 100) {
      return NextResponse.json({ error: "Amount must be a number and at least Rs. 100" }, { status: 400 });
    }

    // If milestoneIds are provided, verify they all belong to this project and are donatable
    if (milestoneIds && milestoneIds.length > 0) {
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
          { error: "One or more selected milestones are invalid or not accepting donations." },
          { status: 400 }
        );
      }
    }

    // Fetch project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.status !== "ACTIVE") {
      return NextResponse.json({ error: "Project is not active and cannot receive donations" }, { status: 400 });
    }

    // Create Razorpay order
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Razorpay = require("razorpay");
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
        milestoneIds,
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
