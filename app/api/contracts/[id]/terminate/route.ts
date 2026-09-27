import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { terminateContract } from "@/lib/contract-service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const contractId = params.id;
    const userId = session.user.id;
    const userRole = session.user.role;

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: { ngo: true },
    });

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    if (userRole === "DONOR" && contract.donorId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (userRole === "NGO" && contract.ngo.userId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json();
    const reason = body.reason?.trim();

    if (!reason) {
      return NextResponse.json({ error: "Termination reason is required." }, { status: 400 });
    }

    const updated = await terminateContract({
      contractId,
      actorId: userId,
      actorRole: userRole,
      reason,
    });

    return NextResponse.json({ contract: updated });
  } catch (error: any) {
    console.error("[api/contracts/[id]/terminate] POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to terminate contract" }, { status: 400 });
  }
}
