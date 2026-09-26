import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import Razorpay from "razorpay";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limiter";

const TARGET_TYPES = ["CRISIS_DIRECT", "NGO_CAMPAIGN", "INITIATIVE"];

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Only donors can make donations" }, { status: 403 });
    }

    const rl = await checkRateLimit(request, "crisis/donate", 20, 3600);
    if (rl.isBlocked) return rl.response;

    const body = await request.json();
    const { targetType, amount, campaignProjectId, initiativeId } = body;

    if (!TARGET_TYPES.includes(targetType)) {
      return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
    }
    if (!amount || typeof amount !== "number" || amount < 100) {
      return NextResponse.json({ error: "Amount must be a number and at least Rs. 100" }, { status: 400 });
    }
    if (targetType === "NGO_CAMPAIGN" && !campaignProjectId) {
      return NextResponse.json({ error: "campaignProjectId is required for this target type" }, { status: 400 });
    }
    if (targetType === "INITIATIVE" && !initiativeId) {
      return NextResponse.json({ error: "initiativeId is required for this target type" }, { status: 400 });
    }

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });
    if (event.status !== "ACTIVE") {
      return NextResponse.json({ error: "This crisis is not currently accepting donations" }, { status: 400 });
    }

    if (targetType === "NGO_CAMPAIGN") {
      const project = await prisma.project.findUnique({ where: { id: campaignProjectId } });
      if (!project || project.crisisEventId !== event.id) {
        return NextResponse.json({ error: "This campaign is not part of this crisis" }, { status: 400 });
      }
    }
    if (targetType === "INITIATIVE") {
      const initiative = await prisma.reliefInitiative.findUnique({ where: { id: initiativeId } });
      if (!initiative || initiative.crisisEventId !== event.id || initiative.status !== "PUBLISHED") {
        return NextResponse.json({ error: "This initiative is not available for donations" }, { status: 400 });
      }
    }

    // Same local-dev mock fallback convention as /api/donations/create-order —
    // lets the flow be tested end-to-end without real Razorpay credentials.
    const isMock =
      !process.env.RAZORPAY_KEY_ID ||
      process.env.RAZORPAY_KEY_ID.includes("xxxxxxxxxxxx") ||
      process.env.RAZORPAY_KEY_ID === "";

    if (isMock) {
      const mockOrderId = `order_mock_crisis_${Date.now()}`;
      const donation = await prisma.$transaction(async (tx) => {
        const isFirstTimeDonor = (await tx.crisisDonation.count({ where: { crisisEventId: event.id, donorId: session.user.id, status: "SUCCESS" } })) === 0;

        const d = await tx.crisisDonation.create({
          data: {
            donorId: session.user.id,
            crisisEventId: event.id,
            targetType,
            campaignProjectId: targetType === "NGO_CAMPAIGN" ? campaignProjectId : null,
            initiativeId: targetType === "INITIATIVE" ? initiativeId : null,
            amount,
            razorpayOrderId: mockOrderId,
            razorpayPaymentId: `pay_mock_crisis_${Date.now()}`,
            status: "SUCCESS",
          },
        });

        await tx.crisisEvent.update({
          where: { id: event.id },
          data: { totalRaised: { increment: amount }, ...(isFirstTimeDonor ? { totalDonors: { increment: 1 } } : {}) },
        });
        if (targetType === "NGO_CAMPAIGN") {
          await tx.project.update({ where: { id: campaignProjectId }, data: { raisedAmount: { increment: amount } } });
        }
        if (targetType === "INITIATIVE") {
          await tx.reliefInitiative.update({ where: { id: initiativeId }, data: { raisedAmount: { increment: amount }, totalDonors: { increment: 1 } } });
        }

        return d;
      });

      return NextResponse.json({
        orderId: mockOrderId,
        amount,
        currency: "INR",
        crisisDonationId: donation.id,
        isMock: true,
      });
    }

    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `crisis_${Date.now()}`,
    });

    const donation = await prisma.crisisDonation.create({
      data: {
        donorId: session.user.id,
        crisisEventId: event.id,
        targetType,
        campaignProjectId: targetType === "NGO_CAMPAIGN" ? campaignProjectId : null,
        initiativeId: targetType === "INITIATIVE" ? initiativeId : null,
        amount,
        razorpayOrderId: order.id,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      orderId: order.id,
      razorpayOrderId: order.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      donorName: session.user.name,
      donorEmail: session.user.email,
      amount,
      currency: "INR",
      crisisDonationId: donation.id,
    });
  } catch (err: any) {
    console.error("Crisis donate error:", err);
    return NextResponse.json({ error: "We couldn't start your donation right now. Please try again in a moment." }, { status: 500 });
  }
}
