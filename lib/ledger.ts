import { Prisma, LedgerDirection, LedgerEntryType } from "@prisma/client";

/**
 * The finance ledger: an append-only record of every money event.
 *
 * Why this exists. `Project.raisedAmount` and `User.totalDonated` are running
 * counters maintained with `increment` from inside the payment webhook. A
 * counter cannot be audited — if one is wrong there is no second record to
 * compare it against, and nothing says what it *should* be. The ledger is that
 * second record: derive a total from it and any disagreement is a finding, not
 * a mystery.
 *
 * Nothing here mutates. There is no update helper and no delete helper,
 * deliberately: a correction to the ledger is a new opposing entry, so the
 * history of what we believed and when survives.
 */

/** Where a ledger entry can point. Ids only — see the model comment. */
export interface LedgerSubject {
  projectId?: string | null;
  ngoId?: string | null;
  donorId?: string | null;
  donationId?: string | null;
  externalRef?: string | null;
}

/**
 * The key that makes a money event un-repeatable.
 *
 * Keyed on the SUBJECT of the event, never on the delivery that carried it —
 * the same reasoning as `webhookDedupeKey` in lib/razorpay-webhook.ts. For a
 * captured donation the subject is the Razorpay payment id, because that is
 * the thing that can only happen once; the donation id would also work, but
 * the payment id is what a bank statement can be matched against.
 */
export function ledgerIdempotencyKey(entryType: LedgerEntryType, subjectRef: string): string {
  return `${entryType}:${subjectRef}`;
}

/**
 * The ledger entry for a confirmed donation, as a Prisma create input.
 *
 * Returned rather than written so the caller can put it INSIDE the transaction
 * that moves the counters. That placement is the whole point: if the ledger
 * write and the increments are not atomic, the two records can disagree
 * precisely when something goes wrong, which is when the ledger is needed.
 *
 * CREDIT: money arriving at the platform on the project's behalf.
 */
export function donationCapturedEntry(args: {
  donationId: string;
  projectId: string;
  ngoId: string;
  donorId: string;
  amount: Prisma.Decimal | string | number;
  paymentId: string;
  /** When Razorpay says the payment was captured — not when we processed it. */
  occurredAt: Date;
}): Prisma.LedgerEntryCreateInput {
  return {
    entryType: LedgerEntryType.DONATION_CAPTURED,
    direction: LedgerDirection.CREDIT,
    amount: new Prisma.Decimal(args.amount.toString()),
    projectId: args.projectId,
    ngoId: args.ngoId,
    donorId: args.donorId,
    donationId: args.donationId,
    externalRef: args.paymentId,
    idempotencyKey: ledgerIdempotencyKey(LedgerEntryType.DONATION_CAPTURED, args.paymentId),
    occurredAt: args.occurredAt,
    metadata: { source: "razorpay_webhook" },
  };
}

/**
 * The entry types that represent CASH the platform actually received or
 * returned.
 *
 * This list is load-bearing, and forgetting it is the easy way to break
 * reconciliation. Every counter check compares a running total against the
 * ledger — but `Project.raisedAmount` and `User.totalDonated` only ever move
 * on donations, while the ledger also carries commitments, which are not cash
 * and never touched those counters. Netting all entry types together would
 * report every allocation as project-total drift: a loud, confident, entirely
 * wrong finding.
 *
 * A new entry type belongs here ONLY if the money genuinely moved in or out.
 */
export const CASH_ENTRY_TYPES: LedgerEntryType[] = [
  LedgerEntryType.DONATION_CAPTURED,
  LedgerEntryType.DONATION_REFUNDED,
];

/**
 * The ledger entry for money committed to an approved proposal.
 *
 * On the COMMITMENT plane, not the cash one — see CASH_ENTRY_TYPES. It is
 * recorded here anyway, rather than only on the Allocation row, so that the
 * money log stays the one chronological answer to "what happened to this
 * opportunity's funds", commitments and receipts alike.
 *
 * DEBIT because the amount is spoken for and no longer available to commit
 * elsewhere. It does NOT reduce any cash balance, and nothing in the
 * reconciler reads it.
 *
 * Keyed on the allocation id, so approving the same allocation twice — a
 * double-clicked button, a retried request — appends nothing the second time.
 */
export function allocationCommittedEntry(args: {
  allocationId: string;
  opportunityId: string;
  ngoId: string;
  amount: Prisma.Decimal | string | number;
  proposalId: string;
  occurredAt: Date;
}): Prisma.LedgerEntryCreateInput {
  return {
    entryType: LedgerEntryType.ALLOCATION_COMMITTED,
    direction: LedgerDirection.DEBIT,
    amount: new Prisma.Decimal(args.amount.toString()),
    // No projectId and no donorId: a commitment belongs to an opportunity and
    // an organisation, and filling those columns would put it inside the very
    // per-project and per-donor sums it must stay out of.
    ngoId: args.ngoId,
    externalRef: args.allocationId,
    idempotencyKey: ledgerIdempotencyKey(LedgerEntryType.ALLOCATION_COMMITTED, args.allocationId),
    occurredAt: args.occurredAt,
    metadata: {
      source: "allocation_approval",
      opportunityId: args.opportunityId,
      proposalId: args.proposalId,
      plane: "COMMITMENT",
    },
  };
}

/**
 * A confirmed transfer against a commitment.
 *
 * CREDIT on the commitment plane: the promise has been honoured, in whole or
 * in part. It is NOT in CASH_ENTRY_TYPES, and that is the honest choice —
 * today a funder pays an organisation directly, so the platform never received
 * this money and must not count it as its own. What this records is that a
 * named admin attested to a transfer, with a reference a statement can be
 * checked against.
 *
 * Keyed on the payment row, so one confirmation lands once however many times
 * it is submitted.
 */
export function allocationFundedEntry(args: {
  paymentId: string;
  allocationId: string;
  ngoId: string;
  amount: Prisma.Decimal | string | number;
  reference: string | null;
  occurredAt: Date;
  recordedById: string;
}): Prisma.LedgerEntryCreateInput {
  return {
    entryType: LedgerEntryType.ALLOCATION_FUNDED,
    direction: LedgerDirection.CREDIT,
    amount: new Prisma.Decimal(args.amount.toString()),
    ngoId: args.ngoId,
    externalRef: args.reference ?? args.allocationId,
    idempotencyKey: ledgerIdempotencyKey(LedgerEntryType.ALLOCATION_FUNDED, args.paymentId),
    occurredAt: args.occurredAt,
    metadata: {
      source: "allocation_payment",
      allocationId: args.allocationId,
      attestedBy: args.recordedById,
      plane: "COMMITMENT",
      hasReference: Boolean(args.reference),
    },
  };
}

/**
 * The provider speaks in PAISE. Every amount in this database is in rupees.
 *
 * Converted through Decimal, never through a float divide: `1/3` of a rupee
 * is not the kind of thing to hand to binary floating point in a money path.
 * Returns null for a payload we cannot read, so the caller has to decide what
 * an unreadable amount means rather than silently getting zero.
 */
export function paiseToRupees(paise: unknown): Prisma.Decimal | null {
  if (typeof paise !== "number" || !Number.isFinite(paise) || paise < 0) return null;
  if (!Number.isInteger(paise)) return null;
  return new Prisma.Decimal(paise).dividedBy(100);
}

/**
 * The ledger entry for money given back.
 *
 * DEBIT: it reverses a credit rather than erasing it. The original capture
 * stays exactly as it was recorded — a donation that was made and then
 * refunded is two facts, and a ledger that deleted the first one could not
 * answer "was this ever paid?".
 *
 * Keyed on the REFUND id, not the payment id: a payment can be refunded more
 * than once (partial refunds), and keying on the payment would silently drop
 * every refund after the first.
 */
export function donationRefundedEntry(args: {
  donationId: string;
  projectId: string;
  ngoId: string;
  donorId: string;
  amount: Prisma.Decimal | string | number;
  refundId: string;
  paymentId: string;
  occurredAt: Date;
  /** Recorded because a refund on a receipted donation is a compliance event. */
  hadTaxReceipt?: boolean;
}): Prisma.LedgerEntryCreateInput {
  return {
    entryType: LedgerEntryType.DONATION_REFUNDED,
    direction: LedgerDirection.DEBIT,
    amount: new Prisma.Decimal(args.amount.toString()),
    projectId: args.projectId,
    ngoId: args.ngoId,
    donorId: args.donorId,
    donationId: args.donationId,
    externalRef: args.refundId,
    idempotencyKey: ledgerIdempotencyKey(LedgerEntryType.DONATION_REFUNDED, args.refundId),
    occurredAt: args.occurredAt,
    metadata: {
      source: "razorpay_webhook",
      paymentId: args.paymentId,
      hadTaxReceipt: Boolean(args.hadTaxReceipt),
    },
  };
}

/**
 * Razorpay reports `created_at` as unix SECONDS, and only on some payloads.
 *
 * A missing or malformed timestamp must not become `new Date(NaN)` — that
 * would write an invalid occurredAt into an immutable row. Falling back to now
 * is slightly wrong and obviously wrong, which is the better failure: the
 * entry still lands and the lateness is visible as a gap against the payment
 * id on the statement.
 */
export function paymentOccurredAt(createdAt: unknown, now: Date = new Date()): Date {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt <= 0) return now;
  const ms = createdAt * 1000;
  const parsed = new Date(ms);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

/**
 * The net of a set of entries: credits minus debits.
 *
 * `amount` is always positive in the table and `direction` carries the sign,
 * so a caller summing the column directly would get a number that means
 * nothing. This is the only correct way to add ledger rows up.
 */
export function netAmount(
  entries: Array<{ direction: LedgerDirection; amount: Prisma.Decimal | string | number }>,
): Prisma.Decimal {
  return entries.reduce(
    (acc, e) =>
      e.direction === LedgerDirection.CREDIT
        ? acc.plus(new Prisma.Decimal(e.amount.toString()))
        : acc.minus(new Prisma.Decimal(e.amount.toString())),
    new Prisma.Decimal(0),
  );
}
