import { NextResponse } from "next/server";
import { Role, ProposalStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import {
  PROPOSAL_TRANSITIONS,
  explainRefusal,
  isProposalAction,
  requiresNote,
} from "@/lib/proposal-workflow";

export const runtime = "nodejs";

/**
 * ADMIN-only. Move one proposal along its lifecycle.
 *
 * SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED, and nothing else. Every
 * move is a compare-and-swap on the status it is allowed to start from, so two
 * admins acting at once cannot both succeed — the loser gets a 409 rather than
 * silently overwriting a decision that was already taken.
 *
 * APPROVED is the gate that matters: it is what Week 6 builds a funded project
 * from. It is therefore terminal, and deliberately has no undo — an approval
 * that can be withdrawn after money has moved is not an approval.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  const adminId = session.user.id;

  let body: { action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isProposalAction(body.action)) {
    return NextResponse.json(
      { error: "action must be START_REVIEW, APPROVE or REJECT" },
      { status: 400 }
    );
  }
  const action = body.action;
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (requiresNote(action) && !note) {
    // "No" with no reason is not something an organisation can act on.
    return NextResponse.json(
      { error: "A rejection must say why — the organisation is told this reason." },
      { status: 400 }
    );
  }

  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, ngoId: true, opportunityId: true },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    }

    const { from, to, logged } = PROPOSAL_TRANSITIONS[action];
    if (proposal.status !== from) {
      return NextResponse.json({ error: explainRefusal(action, proposal.status) }, { status: 409 });
    }

    const decided = to === ProposalStatus.APPROVED || to === ProposalStatus.REJECTED;
    const { count } = await prisma.proposal.updateMany({
      where: { id: params.id, status: from },
      data: {
        status: to,
        // Who picked it up, distinct from who decided it.
        ...(to === ProposalStatus.UNDER_REVIEW ? { reviewerId: adminId } : {}),
        ...(decided
          ? { decidedById: adminId, decidedAt: new Date(), decisionNote: note || null }
          : {}),
      },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "This proposal changed while you were acting on it. Refresh and try again." },
        { status: 409 }
      );
    }

    await logAdminAction({
      adminId,
      action: logged as any,
      entityType: "PROPOSAL",
      entityId: params.id,
      oldValue: { status: from },
      newValue: { status: to },
      note: note || null,
      request,
    });

    return NextResponse.json({ id: params.id, status: to });
  } catch (err: any) {
    console.error("Failed to move proposal:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
