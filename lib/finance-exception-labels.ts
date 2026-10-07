import type { FinanceExceptionType } from "@prisma/client";

/**
 * How a finance exception reads, and which kinds are serious.
 *
 * Lifted out of app/admin/finance/page.tsx when the Today inbox needed the
 * same two judgements (SPEC-2.2). Two pages each holding their own copy of
 * "which exceptions are severe" would drift the moment a type was added to one
 * and not the other, and the drift would be invisible because both pages would
 * still render — the same reasoning that produced lib/today-sources.ts.
 *
 * Type-only import of the enum, so this module stays pure data: no prisma
 * client, no React. lib/today-inbox.ts runs in a plain node test and must be
 * able to import it.
 */

/** Plain-language label per exception type — the enum name is not an answer. */
export const EXCEPTION_LABEL: Record<FinanceExceptionType, string> = {
  UNMATCHED_PAYMENT: "Payment with no donation record",
  MISSING_LEDGER_ENTRY: "Confirmed donation missing from the ledger",
  PROJECT_TOTAL_MISMATCH: "Project raised total disagrees with the ledger",
  DONOR_TOTAL_MISMATCH: "Donor lifetime total disagrees with the ledger",
  STALE_PENDING_DONATION: "Donation stuck pending",
  PAYMENT_AMOUNT_MISMATCH: "Captured amount differs from the donation",
  REFUND_AFTER_RECEIPT: "Refund on a donation with an 80G receipt issued",
  UNCONFIRMED_ALLOCATION: "Committed money never confirmed as received",
  CONTRACT_PAYMENT_DISPUTED: "NGO disputes a donor-recorded contract payment",
};

/**
 * Severity is a property of the TYPE, not of the amount. An unmatched payment
 * of ₹100 is still money we took and cannot account for; a ₹100 drift on a
 * counter is an arithmetic error. Ranking by amount would bury the first kind
 * under the second.
 */
export const SEVERE_EXCEPTION_TYPES: FinanceExceptionType[] = [
  "UNMATCHED_PAYMENT",
  "MISSING_LEDGER_ENTRY",
  // The provider took a different amount than we recorded. No other check can
  // find this one, because every other check compares our records against our
  // own records.
  "PAYMENT_AMOUNT_MISMATCH",
  // A tax document exists for money that was given back.
  "REFUND_AFTER_RECEIPT",
  // An organisation may be planning work against money that never arrived.
  "UNCONFIRMED_ALLOCATION",
  // Donor and NGO disagree about whether contract money arrived. Two parties
  // asserting different facts about the same payment is not arithmetic drift.
  "CONTRACT_PAYMENT_DISPUTED",
];

export function isSevereException(type: FinanceExceptionType): boolean {
  return SEVERE_EXCEPTION_TYPES.includes(type);
}

/** Label, falling back to the de-underscored enum name for a type added later. */
export function exceptionLabel(type: FinanceExceptionType): string {
  return EXCEPTION_LABEL[type] ?? String(type).replace(/_/g, " ").toLowerCase();
}
