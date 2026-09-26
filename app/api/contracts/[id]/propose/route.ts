import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { proposeContract } from "@/lib/contract-service";

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

    // Access check
    if (userRole === "DONOR" && contract.donorId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (userRole === "NGO" && contract.ngo.userId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const updated = await proposeContract({
      contractId,
      actorId: userId,
      actorRole: userRole,
      note: body.note,
    });

    return NextResponse.json({ contract: updated });
  } catch (error: any) {
    console.error("[api/contracts/[id]/propose] POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to propose contract" }, { status: 400 });
  }
}
