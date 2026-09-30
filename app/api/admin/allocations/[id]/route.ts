import { NextResponse } from "next/server";
import { Role, AllocationStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import {
  ALLOCATION_TRANSITIONS,
  checkAllocation,
  committedTotal,
  isAllocationAction,
  requiresNote,
} from "@/lib/allocation";
import { allocationCommittedEntry } from "@/lib/ledger";
import { isUniqueConstraintError } from "@/lib/razorpay-webhook";

export const runtime = "nodejs";

/**
 * ADMIN-only. Approve or reject a pending allocation.
 *
 * Approval is the moment money becomes committed, so three things happen in
 * ONE transaction: the status moves PENDING -> APPROVED as a compare-and-swap,
 * the commitment is written to the money log, and the allocation is pointed at
 * that entry. Split apart, a failure between them would leave a commitment
 * that either has no record on the log or a record with nothing behind it.
 *
 * The budget is re-checked INSIDE the transaction. Budget is a shared
 * resource: two allocations drafted when ₹5L remained can both have looked
 * affordable, and the first to approve consumes it. Checking only at proposal
 * time would let the second one overdraw a real budget.
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

  if (!isAllocationAction(body.action)) {
    return NextResponse.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });
  }
  const action = body.action;
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (requiresNote(action) && !note) {
    return NextResponse.json(
      { error: "A rejection must say why — the organisation is told this reason." },
      { status: 400 },
    );
  }

  const allocation = await prisma.allocation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      amount: true,
      ngoId: true,
      opportunityId: true,
      proposalId: true,
      // The budget is read through the proposal: Allocation.opportunityId is a
      // denormalised id with no relation of its own, kept that way so the
      // sibling sum is one indexed query rather than a join.
      proposal: {
        select: {
          status: true,
          requestedAmount: true,
          opportunity: { select: { amount: true } },
        },
      },
    },
  });

  if (!allocation) {
    return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
  }

  const transition = ALLOCATION_TRANSITIONS[action];
  if (allocation.status !== transition.from) {
    return NextResponse.json(
      { error: `This allocation is already ${allocation.status.toLowerCase()}.` },
      { status: 409 },
    );
  }

  if (action === "REJECT") {
    const { count } = await prisma.allocation.updateMany({
      where: { id: allocation.id, status: AllocationStatus.PENDING },
      data: {
        status: AllocationStatus.REJECTED,
        decidedById: adminId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (count === 0) {
      return NextResponse.json({ error: "This allocation was already decided." }, { status: 409 });
    }

    await logAdminAction({
      adminId,
      action: "ALLOCATION_REJECTED",
      entityType: "ALLOCATION",
      entityId: allocation.id,
      oldValue: { status: AllocationStatus.PENDING },
      newValue: { status: AllocationStatus.REJECTED },
      note,
      metadata: { proposalId: allocation.proposalId },
      request,
    });

    return NextResponse.json({ ok: true, status: AllocationStatus.REJECTED }, { status: 200 });
  }

  // ── APPROVE ────────────────────────────────────────────────────────────
  // Re-run every condition against the world as it is NOW, excluding this
  // allocation's own amount from the committed total so it is not counted
  // against itself.
  const siblings = await prisma.allocation.findMany({
    where: { opportunityId: allocation.opportunityId, id: { not: allocation.id } },
    select: { status: true, amount: true },
  });

  const check = checkAllocation({
    proposalStatus: allocation.proposal.status,
    hasAllocation: false,
    budget: allocation.proposal.opportunity.amount,
    committed: committedTotal(siblings),
    amount: allocation.amount,
    requested: allocation.proposal.requestedAmount,
  });

  if (!check.ok) {
    return NextResponse.json({ error: check.message, refusal: check.refusal }, { status: 409 });
  }

  const entry = allocationCommittedEntry({
    allocationId: allocation.id,
    opportunityId: allocation.opportunityId,
    ngoId: allocation.ngoId,
    amount: allocation.amount,
    proposalId: allocation.proposalId,
    occurredAt: new Date(),
  });

  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.allocation.updateMany({
        where: { id: allocation.id, status: AllocationStatus.PENDING },
        data: {
          status: AllocationStatus.APPROVED,
          decidedById: adminId,
          decidedAt: new Date(),
          ...(note ? { decisionNote: note } : {}),
        },
      });
      // Compare-and-swap lost: another admin decided this first. Throwing
      // rolls back the ledger write too, which is the point of doing both here.
      if (count === 0) throw new Error("ALREADY_DECIDED");

      const created = await tx.ledgerEntry.create({ data: entry, select: { id: true } });
      await tx.allocation.update({
        where: { id: allocation.id },
        data: { ledgerEntryId: created.id },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_DECIDED") {
      return NextResponse.json({ error: "This allocation was already decided." }, { status: 409 });
    }
    // A replayed approval loses on the ledger's unique idempotencyKey. The
    // commitment is already recorded, so this is not a failure.
    if (isUniqueConstraintError(err)) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    throw err;
  }

  await logAdminAction({
    adminId,
    action: "ALLOCATION_APPROVED",
    entityType: "ALLOCATION",
    entityId: allocation.id,
    oldValue: { status: AllocationStatus.PENDING },
    newValue: { status: AllocationStatus.APPROVED, amount: allocation.amount.toFixed(2) },
    ...(note ? { note } : {}),
    metadata: { proposalId: allocation.proposalId, opportunityId: allocation.opportunityId },
    request,
  });

  return NextResponse.json({ ok: true, status: AllocationStatus.APPROVED }, { status: 200 });
}
