import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { CAN_ACCEPT, checkAccept, resolveContractParty } from "@/lib/contract-payments";

/**
 * NGO accepts the funded project behind an ACTIVE contract.
 *
 * Idempotent: accepting twice returns 200 and changes nothing, so a
 * double-click or a retried request cannot write a second audit row.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, donorId: true, ngoId: true, status: true, ngoAcceptedAt: true },
    });
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

    const party = await resolveContractParty(session.user, contract);
    if (!party || party.party !== "NGO") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!CAN_ACCEPT.includes(party.teamRole)) {
      return NextResponse.json({ error: "Only NGO owners or admins can accept a funded project." }, { status: 403 });
    }

    const check = checkAccept(contract);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (check.alreadyAccepted) {
      return NextResponse.json({ accepted: true, ngoAcceptedAt: contract.ngoAcceptedAt });
    }

    const now = new Date();
    const accepted = await prisma.$transaction(async (tx) => {
      // Conditional update: two concurrent accepts race here and only one wins.
      const { count } = await tx.contract.updateMany({
        where: { id: contract.id, ngoAcceptedAt: null, status: "ACTIVE" },
        data: { ngoAcceptedAt: now, ngoAcceptedById: session.user.id },
      });
      if (count === 0) return false;
      await tx.contractAuditLog.create({
        data: {
          contractId: contract.id,
          action: "NGO_ACCEPTED_PROJECT",
          actorId: session.user.id,
          actorRole: "NGO",
          detail: "NGO accepted the funded project, its approved budget and milestones.",
          metadata: { teamRole: party.teamRole },
        },
      });
      return true;
    });

    return NextResponse.json({ accepted: true, ngoAcceptedAt: accepted ? now : contract.ngoAcceptedAt });
  } catch (error) {
    console.error("[api/contracts/[id]/accept] POST error:", error);
    return NextResponse.json({ error: "Failed to accept contract" }, { status: 500 });
  }
}
