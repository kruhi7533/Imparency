import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { donorCan, ROLE_FORBIDDEN } from "@/lib/donor-team";
import { verifySessionRole } from "@/lib/auth-guards";
import { isUniqueConstraintError } from "@/lib/razorpay-webhook";
import {
  checkRecordPayment,
  fundingSummary,
  resolveContractParty,
  sandboxReference,
} from "@/lib/contract-payments";
import { allocateNewPayment, lockContract } from "@/lib/contract-funding";
import { parseUtr } from "@/lib/utr";

/** Payments and the funding summary for one contract. Either party, or an admin. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;

    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        donorId: true,
        ngoId: true,
        totalGrantAmount: true,
        milestones: { select: { id: true, allocatedAmount: true } },
        payments: { orderBy: { paidAt: "desc" } },
        paymentAllocations: { select: { paymentId: true, contractMilestoneId: true, amount: true, status: true } },
      },
    });
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

    const party = await resolveContractParty(session.user, contract);
    if (!party) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    return NextResponse.json({
      payments: contract.payments,
      allocations: contract.paymentAllocations,
      summary: fundingSummary(contract, contract.milestones, contract.payments, contract.paymentAllocations),
    });
  } catch (error) {
    console.error("[api/contracts/[id]/payments] GET error:", error);
    return NextResponse.json({ error: "Failed to load payments" }, { status: 500 });
  }
}

/**
 * The donor records a SANDBOX or MANUAL payment. It starts PENDING_CONFIRMATION
 * until the NGO confirms the money arrived.
 *
 * Idempotent on `idempotencyKey`: replaying the same submission returns the
 * payment already recorded instead of recording it twice.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    // Money and contract state change here; bound how fast any one client can hit it.
    const rl = await checkRateLimit(request, "contracts/payments-record", 20, 60);
    if (rl.isBlocked) return rl.response;
    const { authorized, response, session } = await verifySessionRole(Role.DONOR);
    if (!authorized) return response;

    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      select: { id: true, donorId: true, ngoId: true },
    });
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

    const party = await resolveContractParty(session.user, contract);
    if (!party || party.party !== "DONOR") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!donorCan(party.donorRole, "pay")) {
      return NextResponse.json({ error: ROLE_FORBIDDEN }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      return NextResponse.json({ error: "idempotencyKey is required (8-100 characters)." }, { status: 400 });
    }

    const replay = await findReplay(idempotencyKey, contract.id);
    if (replay) return replay;

    const paidAt = body.paidAt ? new Date(body.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000) {
      return NextResponse.json({ error: "paidAt must be a valid date, not in the future." }, { status: 400 });
    }
    const milestoneId = typeof body.contractMilestoneId === "string" && body.contractMilestoneId ? body.contractMilestoneId : null;

    // The UTR is kept in EVERY mode (lib/utr.ts). `utr` and `reference` are
    // the same field under two names; `utr` wins if both are sent.
    const utrCheck = parseUtr(body.utr ?? body.reference);
    if (!utrCheck.ok) return NextResponse.json({ error: utrCheck.error }, { status: 400 });
    const utr = utrCheck.utr;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Serialise payments on this contract so two concurrent recordings
        // cannot both pass the balance check and overpay it together.
        await lockContract(tx, contract.id);

        const fresh = await tx.contract.findUnique({
          where: { id: contract.id },
          select: {
            status: true,
            ngoAcceptedAt: true,
            totalGrantAmount: true,
            payments: { select: { amount: true, status: true, contractMilestoneId: true } },
          },
        });
        if (!fresh) return { ok: false as const, status: 404, error: "Contract not found" };

        const milestone = milestoneId
          ? await tx.contractMilestone.findUnique({
              where: { id: milestoneId },
              select: { id: true, contractId: true, allocatedAmount: true, title: true },
            })
          : null;
        if (milestoneId && !milestone) return { ok: false as const, status: 400, error: "Milestone not found" };

        const check = checkRecordPayment({
          contract: fresh,
          milestone,
          contractId: contract.id,
          payments: fresh.payments,
          amount: body.amount,
          mode: body.mode,
          reference: utr ?? "",
        });
        if (!check.ok) return check;

        // Duplicate UTR for this payer account (any of its contracts). The
        // unique index is the guarantee; this is the readable answer.
        if (utr) {
          const dup = await tx.contractPayment.findFirst({
            where: { payerAccountId: contract.donorId, utr },
            select: { id: true, contractId: true },
          });
          if (dup) {
            return {
              ok: false as const,
              status: 409,
              error: `UTR ${utr} is already recorded on another payment from your organisation. One bank transfer can fund one payment.`,
            };
          }
        }

        const reference = utr ?? sandboxReference(idempotencyKey);

        const payment = await tx.contractPayment.create({
          data: {
            contractId: contract.id,
            contractMilestoneId: milestone?.id ?? null,
            amount: check.amount,
            mode: body.mode,
            reference,
            utr,
            payerAccountId: contract.donorId,
            paidAt,
            note: typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null,
            recordedById: session.user.id,
            idempotencyKey,
          },
        });

        // Same transaction: the payment is split across milestones now (rule
        // in lib/contract-funding.ts). Funding status does NOT move — this
        // money is pending until reconciled.
        const lines = await allocateNewPayment(tx, {
          contractId: contract.id,
          paymentId: payment.id,
          amount: check.amount,
          milestoneId: milestone?.id ?? null,
          actorId: session.user.id,
        });

        await tx.contractAuditLog.create({
          data: {
            contractId: contract.id,
            action: "PAYMENT_RECORDED",
            actorId: session.user.id,
            actorRole: "DONOR",
            detail: `${body.mode === "SANDBOX" ? "Sandbox" : "Manual"} payment of ₹${check.amount.toFixed(2)} recorded${
              milestone ? ` against "${milestone.title}"` : ""
            }. Awaiting NGO confirmation.`,
            metadata: {
              paymentId: payment.id,
              milestoneId: milestone?.id ?? null,
              amount: check.amount.toFixed(2),
              allocation: lines.map((l) => ({ milestoneId: l.contractMilestoneId, amount: l.amount.toFixed(2) })),
            },
          },
        });

        return { ok: true as const, payment, allocations: lines.map((l) => ({ contractMilestoneId: l.contractMilestoneId, amount: l.amount.toFixed(2) })) };
      });

      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ payment: result.payment, allocations: result.allocations }, { status: 201 });
    } catch (err) {
      // Two identical submissions raced past the replay check; the other won.
      if (isUniqueConstraintError(err)) {
        const replayAfterRace = await findReplay(idempotencyKey, contract.id);
        if (replayAfterRace) return replayAfterRace;
        // Not our key — so the (payerAccountId, utr) index: a concurrent duplicate UTR.
        if (utr) {
          return NextResponse.json(
            { error: `UTR ${utr} is already recorded on another payment from your organisation.` },
            { status: 409 },
          );
        }
      }
      throw err;
    }
  } catch (error) {
    console.error("[api/contracts/[id]/payments] POST error:", error);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}

/**
 * A key already used. Same contract → the earlier result, replayed. Another
 * contract → a conflict, never that contract's payment.
 */
async function findReplay(idempotencyKey: string, contractId: string) {
  const existing = await prisma.contractPayment.findUnique({ where: { idempotencyKey } });
  if (!existing) return null;
  if (existing.contractId !== contractId) {
    return NextResponse.json({ error: "idempotencyKey already used for another contract." }, { status: 409 });
  }
  return NextResponse.json({ payment: existing, replayed: true }, { status: 200 });
}
