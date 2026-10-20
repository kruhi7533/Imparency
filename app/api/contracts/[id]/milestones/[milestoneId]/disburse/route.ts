import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkDonorAction, ROLE_FORBIDDEN } from "@/lib/donor-team";
import { disburseMilestone } from "@/lib/contract-service";

export async function POST(
  request: Request,
  { params }: { params: { id: string; milestoneId: string } }
) {
  try {
    // Money and contract state change here; bound how fast any one client can hit it.
    const rl = await checkRateLimit(request, "contracts/disburse", 20, 60);
    if (rl.isBlocked) return rl.response;
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

    if (userRole === "DONOR") {
      // Team-aware: a member of the donor organisation acts for its account,
      // within their role (lib/donor-team.ts).
      const acts = await checkDonorAction(userId, contract.donorId, "pay");
      if (!acts.ok) {
        return NextResponse.json({ error: acts.reason === "role" ? ROLE_FORBIDDEN : "Access denied" }, { status: 403 });
      }
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
