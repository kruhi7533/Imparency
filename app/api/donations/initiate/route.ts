import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { Role } from "@prisma/client";
import { initiatePayment } from "@/lib/payment-service";

export async function POST(request: Request) {
  try {
    const auth = await verifySessionRole(Role.DONOR);
    if (!auth.authorized) return auth.response;

    const body = await request.json();
    const { projectId, amount, milestoneIds = [] } = body;

    if (!projectId || !amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const result = await initiatePayment({
      donorId: auth.session.user.id,
      projectId,
      amount,
      milestoneIds,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[initiate route] Error initiating donation:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
