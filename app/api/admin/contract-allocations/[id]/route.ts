import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { isAllocationAction, requiresNote } from "@/lib/allocation";
import {
  allocatedByMilestone,
  countingLines,
  lockContract,
  notifyAfterRecalc,
  recalcContractFunding,
} from "@/lib/contract-funding";

export const runtime = "nodejs";

/**
 * ADMIN-only. Approve or reject one payment → milestone allocation line.
 * Body: { action: "APPROVE" | "REJECT", note? }  (note required to reject)
 *
 * - APPROVE only a line whose payment is RECONCILED: an admin vouches for cash
 *   that arrived, not for a claim of payment (409 otherwise).
 * - Over-allocation is re-checked under the contract row lock: a milestone's
 *   counting lines may never exceed what the contract commits to it (422).
 * - Repeating the decision already taken is a no-op 200 (`replayed`); a
 *   different decision on a decided line is a 409. The status write is a
 *   compare-and-swap on PENDING_APPROVAL, so two admins cannot both decide.
 * - A rejection stops the line counting; milestone funding is recalculated in
 *   the same transaction.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  const body = await request.json().catch(() => null);
  if (!body || !isAllocationAction(body.action)) {
    return NextResponse.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });
  }
  const action = body.action;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  if (requiresNote(action) && !note) {
    return NextResponse.json({ error: "A rejection must say why." }, { status: 400 });
  }

  const line = await prisma.contractPaymentAllocation.findUnique({
    where: { id: params.id },
    select: { id: true, contractId: true },
  });
  if (!line) return NextResponse.json({ error: "Allocation not found" }, { status: 404 });

  const target = action === "APPROVE" ? "APPROVED" : "REJECTED";

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockContract(tx, line.contractId);
      const fresh = await tx.contractPaymentAllocation.findUnique({
        where: { id: line.id },
        select: {
          id: true,
          status: true,
          amount: true,
          paymentId: true,
          contractMilestoneId: true,
          payment: { select: { status: true } },
          contractMilestone: { select: { allocatedAmount: true } },
        },
      });
      if (!fresh) return { ok: false as const, status: 404, error: "Allocation not found" };
      if (fresh.status === target) return { ok: true as const, replayed: true, line: fresh, funding: null };
      if (fresh.status !== "PENDING_APPROVAL") {
        return { ok: false as const, status: 409, error: `This allocation is already ${fresh.status}.` };
      }

      if (action === "APPROVE") {
        if (fresh.payment.status !== "RECONCILED") {
          return {
            ok: false as const,
            status: 409,
            error: `Only reconciled money can be approved onto a milestone; this payment is ${fresh.payment.status}.`,
          };
        }
        const [lines, payments] = await Promise.all([
          tx.contractPaymentAllocation.findMany({
            where: { contractMilestoneId: fresh.contractMilestoneId },
            select: { paymentId: true, contractMilestoneId: true, amount: true, status: true },
          }),
          tx.contractPayment.findMany({ where: { contractId: line.contractId }, select: { id: true, amount: true, status: true } }),
        ]);
        const onMilestone = allocatedByMilestone(countingLines(lines, payments)).get(fresh.contractMilestoneId) ?? new Prisma.Decimal(0);
        if (onMilestone.greaterThan(fresh.contractMilestone.allocatedAmount)) {
          return {
            ok: false as const,
            status: 422,
            error: `Over-allocation: lines on this milestone total ₹${onMilestone.toFixed(2)}, above its ₹${fresh.contractMilestone.allocatedAmount.toFixed(2)} commitment. Reject a line first.`,
          };
        }
      }

      const { count } = await tx.contractPaymentAllocation.updateMany({
        where: { id: fresh.id, status: "PENDING_APPROVAL" },
        data: { status: target, decidedById: session.user.id, decidedAt: new Date(), decisionNote: note || null },
      });
      if (count === 0) return { ok: false as const, status: 409, error: "Decided by someone else just now. Refresh." };

      await tx.contractAuditLog.create({
        data: {
          contractId: line.contractId,
          action: action === "APPROVE" ? "ALLOCATION_APPROVED" : "ALLOCATION_REJECTED",
          actorId: session.user.id,
          actorRole: "ADMIN",
          detail:
            action === "APPROVE"
              ? `Admin approved ₹${fresh.amount.toFixed(2)} of a reconciled payment onto a milestone.`
              : `Admin rejected a ₹${fresh.amount.toFixed(2)} milestone allocation: ${note}`,
          metadata: { allocationId: fresh.id, paymentId: fresh.paymentId, milestoneId: fresh.contractMilestoneId },
        },
      });
      const funding = action === "REJECT" ? await recalcContractFunding(tx, line.contractId) : null;
      return { ok: true as const, replayed: false, line: fresh, funding };
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    if (result.replayed) return NextResponse.json({ ok: true, replayed: true, status: target });
    if (result.funding) await notifyAfterRecalc(line.contractId, result.funding);

    await logAdminAction({
      adminId: session.user.id,
      action: action === "APPROVE" ? "ALLOCATION_APPROVED" : "ALLOCATION_REJECTED",
      entityType: "ALLOCATION",
      entityId: line.id,
      oldValue: { status: "PENDING_APPROVAL" },
      newValue: { status: target },
      note: note || null,
      metadata: { kind: "CONTRACT_PAYMENT", contractId: line.contractId, paymentId: result.line.paymentId },
      request,
    });
    return NextResponse.json({ ok: true, status: target });
  } catch (error) {
    console.error("[api/admin/contract-allocations/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to decide allocation" }, { status: 500 });
  }
}
