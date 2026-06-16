import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import Razorpay from "razorpay";
import { Role } from "@prisma/client";

export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.DONOR);
  if (!auth.authorized) {
    return auth.response;
  }
  
  const userId = auth.session.user.id;

  try {
    const body = await request.json();
    const { projectId, amount, name, panNumber, billingAddress } = body;

    if (!projectId || !amount || Number(amount) <= 0) {
      return NextResponse.json({ error: "Invalid project ID or amount" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const finalName = name || user.name;
    const finalPan = panNumber || user.panNumber;
    const finalAddress = billingAddress || user.billingAddress;

    if (!finalName || !finalPan || !finalAddress) {
      return NextResponse.json({
        error: "Missing donor details",
        missingDetails: {
          name: !finalName,
          panNumber: !finalPan,
          billingAddress: !finalAddress,
        }
      }, { status: 400 });
    }

    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(finalPan)) {
      return NextResponse.json({ error: "Invalid PAN format" }, { status: 400 });
    }

    if (finalName !== user.name || finalPan !== user.panNumber || finalAddress !== user.billingAddress) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          name: finalName,
          panNumber: finalPan,
          billingAddress: finalAddress,
        },
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project || project.status !== "ACTIVE") {
      return NextResponse.json({ error: "Project is not active or does not exist" }, { status: 400 });
    }

    const donation = await prisma.donation.create({
      data: {
        donorId: userId,
        projectId: projectId,
        amount: amount,
        razorpayOrderId: "pending_order_id",
        status: "PENDING",
      },
    });

    const keyId = process.env.RAZORPAY_KEY_ID || "rzp_test_mockkeyid";
    const keySecret = process.env.RAZORPAY_KEY_SECRET || "mockkeysecret";
    
    let razorpayOrderId = "";
    
    try {
      const razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });

      const orderOptions = {
        amount: Math.round(Number(amount) * 100), // in paise
        currency: "INR",
        receipt: donation.id,
      };

      const rpOrder = await razorpay.orders.create(orderOptions);
      razorpayOrderId = rpOrder.id;
    } catch (rpErr) {
      console.warn("Razorpay API call failed, using mock order ID in dev:", rpErr);
      if (process.env.NODE_ENV !== "production") {
        razorpayOrderId = `order_${donation.id.substring(0, 14)}`;
      } else {
        await prisma.donation.delete({ where: { id: donation.id } });
        return NextResponse.json({ error: "Razorpay order creation failed" }, { status: 500 });
      }
    }

    const updatedDonation = await prisma.donation.update({
      where: { id: donation.id },
      data: { razorpayOrderId },
    });

    return NextResponse.json({
      donationId: updatedDonation.id,
      razorpayOrderId: updatedDonation.razorpayOrderId,
      amount: updatedDonation.amount,
      keyId: keyId,
      donorName: finalName,
      donorEmail: auth.session.user.email,
      projectTitle: project.title,
    });

  } catch (err: any) {
    console.error("Order creation error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
