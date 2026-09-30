import { Prisma, FinanceExceptionStatus, FinanceExceptionType } from "@prisma/client";
import prisma from "@/lib/prisma";
// Generic P2002 test; it lives in razorpay-webhook.ts because that is where the
// repo first needed it. Imported rather than re-declared so there is one
// answer to "what does a unique-constraint violation look like".
import { isUniqueConstraintError } from "@/lib/razorpay-webhook";

/**
 * The finance exception queue.
 *
 * An exception is a money fact that does not add up and that a human has to
 * answer for. Two rules shape everything here:
 *
 * 1. Re-running the reconciler must not duplicate a finding. Reconciliation is
 *    meant to be run often — hourly, on demand, after an incident — and a
 *    queue that grows a row per run is a queue nobody reads. This is the same
 *    lesson as the fraud-alert dedupe (lib/risk-agent.ts): duplicates destroy
 *    a queue's usefulness faster than misses do.
 * 2. A finding that was RESOLVED and then comes back must open a NEW row.
 *    "We investigated this and closed it, and it happened again" is a
 *    different fact from "still open", and quietly reopening the old row would
 *    erase the first investigation's outcome.
 */

export type FinanceEntityType = "PROJECT" | "DONOR" | "DONATION" | "PAYMENT";

export interface ExceptionFinding {
  type: FinanceExceptionType;
  entityType: FinanceEntityType;
  entityId: string;
  /**
   * Ids and amounts only — never a donor name, email, or organisation name.
   * This queue is read by admins and exported; audit context in this repo is
   * ids-only by rule (CLAUDE.md, Privacy).
   */
  summary: string;
  expectedAmount?: Prisma.Decimal | null;
  observedAmount?: Prisma.Decimal | null;
  detail?: Prisma.InputJsonValue;
}

/**
 * `type:entityId` for the first occurrence, `type:entityId:N` after a
 * resolution. The generation suffix is what lets the same discrepancy be
 * raised twice without breaking the unique index that keeps re-runs idempotent.
 */
export function exceptionDedupeKey(
  type: FinanceExceptionType,
  entityId: string,
  generation = 0,
): string {
  return generation === 0 ? `${type}:${entityId}` : `${type}:${entityId}:${generation}`;
}

export type RecordOutcome = "opened" | "recurred";

/**
 * Open a finding, or bump the one already open for this subject.
 *
 * Amounts are overwritten on a recurrence on purpose: a drift that grew from
 * ₹100 to ₹900 should read as ₹900 now, with `occurrences` and `firstSeenAt`
 * carrying the history of how long it has been wrong.
 */
export async function recordException(finding: ExceptionFinding): Promise<RecordOutcome> {
  const open = await prisma.financeException.findFirst({
    where: {
      type: finding.type,
      entityId: finding.entityId,
      status: FinanceExceptionStatus.OPEN,
    },
    select: { id: true },
  });

  if (open) {
    await prisma.financeException.update({
      where: { id: open.id },
      data: {
        lastSeenAt: new Date(),
        occurrences: { increment: 1 },
        summary: finding.summary,
        expectedAmount: finding.expectedAmount ?? null,
        observedAmount: finding.observedAmount ?? null,
        ...(finding.detail !== undefined ? { detail: finding.detail } : {}),
      },
    });
    return "recurred";
  }

  // No open row. Any RESOLVED rows for this subject decide the generation, so
  // the new row does not collide with the closed one on the unique key.
  const generation = await prisma.financeException.count({
    where: { type: finding.type, entityId: finding.entityId },
  });

  try {
    await prisma.financeException.create({
      data: {
        type: finding.type,
        entityType: finding.entityType,
        entityId: finding.entityId,
        dedupeKey: exceptionDedupeKey(finding.type, finding.entityId, generation),
        summary: finding.summary,
        expectedAmount: finding.expectedAmount ?? null,
        observedAmount: finding.observedAmount ?? null,
        ...(finding.detail !== undefined ? { detail: finding.detail } : {}),
      },
    });
    return "opened";
  } catch (err) {
    // Two reconciler runs overlapped and both decided to open this. The other
    // one won; that is the row, and this run has nothing to add.
    if (isUniqueConstraintError(err)) return "recurred";
    throw err;
  }
}

/**
 * Close an arithmetic exception whose subject now balances.
 *
 * Only the reconciler calls this, and only for discrepancies it can re-derive:
 * an UNMATCHED_PAYMENT is never auto-resolved, because nothing the reconciler
 * can see proves the payment was dealt with — a human has to say so.
 */
export async function autoResolveExceptions(
  type: FinanceExceptionType,
  entityIds: string[],
  note: string,
): Promise<number> {
  if (entityIds.length === 0) return 0;
  const { count } = await prisma.financeException.updateMany({
    where: { type, entityId: { in: entityIds }, status: FinanceExceptionStatus.OPEN },
    data: {
      status: FinanceExceptionStatus.RESOLVED,
      resolvedAt: new Date(),
      // resolvedById stays null: the platform closed this, not a person. Same
      // convention as AdminActionLog.adminId.
      resolutionNote: note,
    },
  });
  return count;
}

/** Exception types the reconciler re-derives from scratch on every run. */
export const AUTO_RESOLVABLE_TYPES: FinanceExceptionType[] = [
  FinanceExceptionType.PROJECT_TOTAL_MISMATCH,
  FinanceExceptionType.DONOR_TOTAL_MISMATCH,
  FinanceExceptionType.MISSING_LEDGER_ENTRY,
  FinanceExceptionType.STALE_PENDING_DONATION,
];

/**
 * A captured payment that matches no donation row.
 *
 * Razorpay reports `amount` in PAISE. Dividing by 100 here rather than at the
 * display layer keeps every amount in the exception queue in rupees, the same
 * unit as every other amount in the database - a queue that mixes units is a
 * queue that gets misread under pressure.
 *
 * The subject is the PAYMENT id, not the order id: the payment is the thing
 * money actually attached to, and it is what a statement line carries.
 */
export async function recordUnmatchedPayment(
  payment: { id?: unknown; amount?: unknown; currency?: unknown },
  orderId: string,
): Promise<RecordOutcome> {
  const paymentId = typeof payment.id === "string" ? payment.id : `order:${orderId}`;
  const paise = typeof payment.amount === "number" && Number.isFinite(payment.amount) ? payment.amount : null;
  const rupees = paise === null ? null : new Prisma.Decimal(paise).dividedBy(100);

  return recordException({
    type: FinanceExceptionType.UNMATCHED_PAYMENT,
    entityType: "PAYMENT",
    entityId: paymentId,
    summary:
      rupees === null
        ? `Captured payment with no donation row (amount not reported)`
        : `Captured payment of ${rupees.toFixed(2)} with no donation row`,
    observedAmount: rupees,
    detail: { orderId, currency: typeof payment.currency === "string" ? payment.currency : null },
  });
}
