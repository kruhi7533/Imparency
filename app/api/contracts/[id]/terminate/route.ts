import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkDonorAction, ROLE_FORBIDDEN } from "@/lib/donor-team";
import { terminateContract } from "@/lib/contract-service";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Money and contract state change here; bound how fast any one client can hit it.
    const rl = await checkRateLimit(request, "contracts/terminate", 10, 60);
    if (rl.isBlocked) return rl.response;
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

    if (userRole === "DONOR") {
      // Team-aware: a member of the donor organisation acts for its account,
      // within their role (lib/donor-team.ts).
      const acts = await checkDonorAction(userId, contract.donorId, "terminate");
      if (!acts.ok) {
        return NextResponse.json({ error: acts.reason === "role" ? ROLE_FORBIDDEN : "Access denied" }, { status: 403 });
      }
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
