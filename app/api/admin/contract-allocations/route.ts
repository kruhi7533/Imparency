import { NextResponse } from "next/server";
import { PaymentAllocationStatus, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import {
  checkManualAllocation,
  lockContract,
  notifyAfterRecalc,
  recalcContractFunding,
} from "@/lib/contract-funding";

export const runtime = "nodejs";

const STATUSES = Object.values(PaymentAllocationStatus) as string[];

/**
 * ADMIN-only. Payment → milestone allocation lines on the requirement →
 * contract flow (lib/contract-funding.ts), for the approval queue.
 *
 * ?status=PENDING_APPROVAL|APPROVED|REJECTED (default: all) &contractId=
 */
export async function GET(request: Request) {
  const { authorized, response } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const contractId = url.searchParams.get("contractId");
  if (status && !STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
  }

  const allocations = await prisma.contractPaymentAllocation.findMany({
    where: {
      ...(status ? { status: status as PaymentAllocationStatus } : {}),
      ...(contractId ? { contractId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      amount: true,
      rule: true,
      status: true,
      decidedAt: true,
      decisionNote: true,
      createdAt: true,
      contractMilestone: { select: { id: true, title: true, allocatedAmount: true, fundingStatus: true, orderIndex: true } },
      payment: { select: { id: true, amount: true, status: true, mode: true, reference: true, utr: true, paidAt: true } },
      contract: { select: { id: true, contractNumber: true, title: true, requirementId: true, status: true, fundedAt: true } },
    },
  });

  return NextResponse.json({
    allocations: allocations.map((a) => ({
      ...a,
      amount: a.amount.toFixed(2),
      contractMilestone: { ...a.contractMilestone, allocatedAmount: a.contractMilestone.allocatedAmount.toFixed(2) },
      payment: { ...a.payment, amount: a.payment.amount.toFixed(2) },
    })),
  });
}

/**
 * ADMIN-only. Allocate (part of) a contract payment to a milestone by hand —
 * the follow-up to rejecting an automatic line. Body:
 * { paymentId, contractMilestoneId, amount }
 *
 * Over-allocation of the payment or the milestone is refused with 422, checked
 * inside a transaction holding the contract row lock so two admins cannot
 * both spend the same room.
 */
export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.paymentId !== "string" || typeof body.contractMilestoneId !== "string") {
    return NextResponse.json({ error: "paymentId and contractMilestoneId are required." }, { status: 400 });
  }

  const payment = await prisma.contractPayment.findUnique({
    where: { id: body.paymentId },
    select: { id: true, contractId: true },
  });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockContract(tx, payment.contractId);
      const [fresh, milestone, lines, payments] = await Promise.all([
        tx.contractPayment.findUnique({ where: { id: payment.id }, select: { id: true, amount: true, status: true, contractId: true } }),
        tx.contractMilestone.findUnique({
          where: { id: body.contractMilestoneId },
          select: { id: true, contractId: true, allocatedAmount: true },
        }),
        tx.contractPaymentAllocation.findMany({
          where: { contractId: payment.contractId },
          select: { id: true, paymentId: true, contractMilestoneId: true, amount: true, status: true },
        }),
        tx.contractPayment.findMany({ where: { contractId: payment.contractId }, select: { id: true, amount: true, status: true } }),
      ]);
      if (!fresh) return { ok: false as const, status: 404, error: "Payment not found" };
      if (!milestone) return { ok: false as const, status: 404, error: "Milestone not found" };

      const check = checkManualAllocation({ payment: fresh, milestone, lines, payments, amount: body.amount });
      if (!check.ok) return check;

      const existing = lines.find((l) => l.paymentId === fresh.id && l.contractMilestoneId === milestone.id);
      if (existing && existing.status !== "REJECTED") {
        return {
          ok: false as const,
          status: 409,
          error: "This payment already has a line on that milestone. Reject it first to change the amount.",
        };
      }
      // One row per (payment, milestone): a previously rejected line is
      // re-opened as a new manual decision; the rejection stays in the admin log.
      const line = existing
        ? await tx.contractPaymentAllocation.update({
            where: { id: existing.id },
            data: {
              amount: check.amount,
              rule: "ADMIN_MANUAL",
              status: "PENDING_APPROVAL",
              createdById: session.user.id,
              decidedById: null,
              decidedAt: null,
              decisionNote: null,
            },
          })
        : await tx.contractPaymentAllocation.create({
            data: {
              paymentId: fresh.id,
              contractId: fresh.contractId,
              contractMilestoneId: milestone.id,
              amount: check.amount,
              rule: "ADMIN_MANUAL",
              createdById: session.user.id,
            },
          });
      const funding = await recalcContractFunding(tx, fresh.contractId);
      return { ok: true as const, line, funding };
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    await notifyAfterRecalc(payment.contractId, result.funding);
    await logAdminAction({
      adminId: session.user.id,
      action: "ALLOCATION_PROPOSED",
      entityType: "ALLOCATION",
      entityId: result.line.id,
      newValue: { status: result.line.status, amount: result.line.amount.toFixed(2), rule: "ADMIN_MANUAL" },
      metadata: { kind: "CONTRACT_PAYMENT", paymentId: payment.id, contractId: payment.contractId, contractMilestoneId: body.contractMilestoneId },
      request,
    });
    return NextResponse.json({ allocation: { ...result.line, amount: result.line.amount.toFixed(2) } }, { status: 201 });
  } catch (error) {
    console.error("[api/admin/contract-allocations] POST error:", error);
    return NextResponse.json({ error: "Failed to allocate payment" }, { status: 500 });
  }
}
