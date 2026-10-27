import { FinanceExceptionStatus, FinanceExceptionType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { rematchNgoStatements } from "@/lib/bank-statement";
import { autoResolveExceptions, recordException } from "@/lib/finance-exceptions";
import { notifyAfterRecalc, recalcContractFunding } from "@/lib/contract-funding";
import { normalizeUtr } from "@/lib/utr";

/**
 * The admin side of UTR reconciliation (ADM-009 / D5).
 *
 * NGOs import bank statements (lib/bank-statement.ts). The admin sweep — run
 * from POST /api/admin/finance/reconcile — re-matches every NGO's still-open
 * credit lines against pending contract payments by UTR + exact amount (+ date
 * window), reconciles the clear matches, and puts every line it still cannot
 * place into the finance exception queue as UNMATCHED_BANK_LINE, where an
 * admin matches it to a payment by hand or resolves it with a note.
 *
 * Idempotent: a matched line is never re-examined; payments move only from
 * PENDING_CONFIRMATION (compare-and-swap); recordException dedupes per line;
 * and a line an admin already resolved ("not a contract payment") is not
 * raised again on every sweep — otherwise each run would reopen it.
 */

const dec = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v.toString());
const OPEN_LINE_STATUSES = ["UNMATCHED", "AMBIGUOUS", "AMOUNT_MISMATCH"] as const;

export interface UtrSweepResult {
  ngosChecked: number;
  matched: number;
  amountMismatch: number;
  queued: number;
  autoResolved: number;
  contractsRecalculated: number;
}

export async function runUtrSweep(adminId: string): Promise<UtrSweepResult> {
  const ngoRows = await prisma.bankStatementLine.findMany({
    where: { direction: "CREDIT", status: { in: [...OPEN_LINE_STATUSES] } },
    distinct: ["ngoId"],
    select: { ngoId: true },
  });

  const result: UtrSweepResult = { ngosChecked: ngoRows.length, matched: 0, amountMismatch: 0, queued: 0, autoResolved: 0, contractsRecalculated: 0 };
  for (const { ngoId } of ngoRows) {
    const r = await rematchNgoStatements(ngoId, adminId, undefined, "ADMIN");
    result.matched += r.matched.length;
    result.amountMismatch += r.amountMismatch;
  }

  // Unmatched / ambiguous lines → exception queue (amount mismatches already
  // raised BANK_LINE_AMOUNT_MISMATCH inside rematch).
  const open = await prisma.bankStatementLine.findMany({
    where: { direction: "CREDIT", status: { in: ["UNMATCHED", "AMBIGUOUS"] } },
    select: { id: true, ngoId: true, amount: true, status: true, valueDate: true, reference: true, candidatePaymentIds: true },
  });
  const resolvedBefore = new Set(
    (
      await prisma.financeException.findMany({
        where: {
          type: FinanceExceptionType.UNMATCHED_BANK_LINE,
          entityId: { in: open.map((l) => l.id) },
          status: FinanceExceptionStatus.RESOLVED,
        },
        select: { entityId: true },
      })
    ).map((e) => e.entityId),
  );
  for (const line of open) {
    if (resolvedBefore.has(line.id)) continue;
    await recordException({
      type: FinanceExceptionType.UNMATCHED_BANK_LINE,
      entityType: "BANK_LINE",
      entityId: line.id,
      summary:
        line.status === "AMBIGUOUS"
          ? `Bank credit of ${dec(line.amount).toFixed(2)} fits more than one pending contract payment`
          : `Bank credit of ${dec(line.amount).toFixed(2)} matches no pending contract payment by UTR`,
      observedAmount: dec(line.amount),
      detail: {
        ngoId: line.ngoId,
        lineStatus: line.status,
        valueDate: line.valueDate.toISOString().slice(0, 10),
        utr: line.reference ? normalizeUtr(line.reference) : null,
        candidatePaymentIds: line.candidatePaymentIds,
      },
    });
    result.queued++;
  }

  // Lines matched since they were queued close their exception on their own.
  const queuedOpen = await prisma.financeException.findMany({
    where: { type: FinanceExceptionType.UNMATCHED_BANK_LINE, status: FinanceExceptionStatus.OPEN },
    select: { entityId: true },
  });
  if (queuedOpen.length) {
    const nowMatched = await prisma.bankStatementLine.findMany({
      where: { id: { in: queuedOpen.map((e) => e.entityId) }, status: "MATCHED" },
      select: { id: true },
    });
    result.autoResolved = await autoResolveExceptions(
      FinanceExceptionType.UNMATCHED_BANK_LINE,
      nowMatched.map((l) => l.id),
      "Matched to a contract payment by UTR on a later reconciliation run.",
    );
  }

  // Heal milestone funding on every signed contract with money on it —
  // including payments recorded before allocation lines existed.
  const contracts = await prisma.contract.findMany({
    where: { status: { in: ["ACTIVE", "COMPLETED"] }, payments: { some: {} } },
    select: { id: true },
  });
  for (const c of contracts) {
    const funding = await prisma.$transaction((tx) => recalcContractFunding(tx, c.id));
    await notifyAfterRecalc(c.id, funding);
    result.contractsRecalculated++;
  }
  return result;
}

export class BankLineMatchError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * An admin matches an unmatched bank line to a pending contract payment by
 * hand. Same NGO only, exact amount only (422 otherwise — a partial match is a
 * dispute, not a match), payment must still be PENDING_CONFIRMATION. Replaying
 * the same match is a no-op.
 */
export async function adminMatchBankLine(args: { lineId: string; paymentId: string; adminId: string; note: string }) {
  const [line, payment] = await Promise.all([
    prisma.bankStatementLine.findUnique({ where: { id: args.lineId } }),
    prisma.contractPayment.findUnique({
      where: { id: args.paymentId },
      select: { id: true, amount: true, status: true, utr: true, reference: true, contractId: true, contract: { select: { ngoId: true } } },
    }),
  ]);
  if (!line) throw new BankLineMatchError("Bank line not found", 404);
  if (!payment) throw new BankLineMatchError("Payment not found", 404);
  if (line.matchedPaymentId === payment.id) return { replayed: true, contractId: payment.contractId, funding: null };
  if (line.direction !== "CREDIT") throw new BankLineMatchError("Only a credit can evidence a payment.", 400);
  if (line.status === "MATCHED") throw new BankLineMatchError("This line is already matched to another payment.", 409);
  if (payment.contract.ngoId !== line.ngoId) {
    throw new BankLineMatchError("The payment belongs to a different NGO than this bank statement.", 403);
  }
  if (!dec(payment.amount).equals(dec(line.amount))) {
    throw new BankLineMatchError(
      `Amounts differ: the line shows ₹${dec(line.amount).toFixed(2)}, the payment was recorded for ₹${dec(payment.amount).toFixed(2)}. Raise it with the parties instead.`,
      422,
    );
  }
  if (payment.status !== "PENDING_CONFIRMATION") {
    throw new BankLineMatchError(`This payment is already ${payment.status}.`, 409);
  }

  const now = new Date();
  const funding = await prisma.$transaction(async (tx) => {
    const { count } = await tx.contractPayment.updateMany({
      where: { id: payment.id, status: "PENDING_CONFIRMATION", bankLine: null },
      data: { status: "RECONCILED", confirmedById: args.adminId, confirmedAt: now, reconciledVia: "ADMIN_BANK_MATCH" },
    });
    if (count === 0) throw new BankLineMatchError("The payment was decided by someone else just now. Refresh.", 409);
    const lineUpdate = await tx.bankStatementLine.updateMany({
      where: { id: line.id, status: { not: "MATCHED" } },
      data: { status: "MATCHED", matchedPaymentId: payment.id, candidatePaymentIds: [payment.id], note: `Matched by an admin: ${args.note}`.slice(0, 500) },
    });
    if (lineUpdate.count === 0) throw new BankLineMatchError("This line was matched by someone else just now. Refresh.", 409);
    await tx.contractAuditLog.create({
      data: {
        contractId: payment.contractId,
        action: "PAYMENT_RECONCILED",
        actorId: args.adminId,
        actorRole: "ADMIN",
        detail: `Admin matched the payment to a bank credit of ₹${dec(line.amount).toFixed(2)} on ${line.valueDate.toISOString().slice(0, 10)}.`,
        metadata: { paymentId: payment.id, bankLineId: line.id, via: "ADMIN_BANK_MATCH" },
      },
    });
    return recalcContractFunding(tx, payment.contractId, now);
  });

  await prisma.financeException.updateMany({
    where: { type: FinanceExceptionType.UNMATCHED_BANK_LINE, entityId: line.id, status: FinanceExceptionStatus.OPEN },
    data: { status: FinanceExceptionStatus.RESOLVED, resolvedAt: now, resolvedById: args.adminId, resolutionNote: `Matched to contract payment ${payment.id}. ${args.note}` },
  });
  await notifyAfterRecalc(payment.contractId, funding);
  return { replayed: false, contractId: payment.contractId, funding };
}

/** Pending payments an admin could match a line to (same NGO, still pending). */
export async function matchCandidates(ngoIds: string[]) {
  if (ngoIds.length === 0) return [];
  return prisma.contractPayment.findMany({
    where: { status: "PENDING_CONFIRMATION", bankLine: null, contract: { ngoId: { in: ngoIds } } },
    orderBy: { paidAt: "desc" },
    take: 200,
    select: { id: true, amount: true, reference: true, utr: true, paidAt: true, contract: { select: { ngoId: true, contractNumber: true } } },
  });
}
