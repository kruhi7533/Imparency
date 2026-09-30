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
