import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { disburseMilestone } from "@/lib/contract-service";

export async function POST(
  request: Request,
  { params }: { params: { id: string; milestoneId: string } }
) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const { id: contractId, milestoneId } = params;
    const userId = session.user.id;
    const userRole = session.user.role;

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
    });

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    if (userRole === "DONOR" && contract.donorId !== userId) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (userRole !== "DONOR" && userRole !== "ADMIN") {
      return NextResponse.json({ error: "Only the Donor or an Admin can authorize milestone disbursement." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const updated = await disburseMilestone({
      contractId,
      milestoneId,
      actorId: userId,
      actorRole: userRole as "DONOR" | "ADMIN",
      note: body.note,
    });

    return NextResponse.json({ contract: updated });
  } catch (error: any) {
    console.error("[api/contracts/[id]/milestones/disburse] POST error:", error);
    return NextResponse.json({ error: error.message || "Failed to disburse milestone" }, { status: 400 });
  }
}
