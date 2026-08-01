/**
 * The strict budget-compliance rule, and the parser for stored AI validation
 * results.
 *
 * This module deliberately has NO dependencies — it is imported by the client
 * (`app/admin/proof-review/ProofReviewClient.tsx`), by the server enforcement
 * path (`app/api/admin/review-proof/route.ts`), and by the Gemini validator
 * (`lib/gemini/validate-proof.ts`). Keeping the rule here rather than in
 * validate-proof.ts is what lets the client share it: validate-proof.ts imports
 * the @google/genai SDK, which must not be pulled into the client bundle.
 */

export type BudgetStatus =
  | "ALIGNED" // financial evidence present and spend is within the milestone budget
  | "UNDER_BUDGET" // evidence present, spend materially below budget (surfaced, not blocking)
  | "OVER_BUDGET" // claimed/evidenced spend exceeds the milestone budget
  | "NO_EVIDENCE" // no receipts/invoices/financial proof submitted at all
  | "UNCLEAR"; // files present but amounts can't be determined

export const ALLOWED_BUDGET_STATUSES: BudgetStatus[] = [
  "ALIGNED",
  "UNDER_BUDGET",
  "OVER_BUDGET",
  "NO_EVIDENCE",
  "UNCLEAR",
];

/** The strict budget rule: anything other than a clean ALIGNED/UNDER_BUDGET is a violation. */
export const BUDGET_VIOLATION_STATUSES: BudgetStatus[] = ["OVER_BUDGET", "NO_EVIDENCE", "UNCLEAR"];

export function isBudgetViolation(status: string | null | undefined): boolean {
  return status != null && (BUDGET_VIOLATION_STATUSES as string[]).includes(status);
}

/** Normalize whatever the model returns into a known BudgetStatus (defaults to UNCLEAR). */
export function normalizeBudgetStatus(raw: unknown): BudgetStatus {
  if (typeof raw === "string") {
    const up = raw.trim().toUpperCase();
    if ((ALLOWED_BUDGET_STATUSES as string[]).includes(up)) return up as BudgetStatus;
  }
  return "UNCLEAR";
}

/** The budget verdict as read back off a stored proof. */
export interface BudgetVerdict {
  status: BudgetStatus;
  claimed: number | null;
  reasoning: string;
}

/**
 * Parse a stored `Proof.aiValidationResult` JSON blob. Returns null when the
 * column is empty or unparseable — proofs validated before a field was added
 * simply read back as absent rather than throwing.
 *
 * Every reader of that column should go through here so the client's UI verdict
 * and the server's enforcement verdict can never drift apart.
 */
// Values are `any` because the stored blob is whatever the model returned at the
// time the proof was validated — older rows legitimately lack newer fields, so
// callers null-check the fields they read rather than trusting a fixed shape.
export function parseValidationResult(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

/**
 * Read the budget verdict off a stored proof result. Returns null when the proof
 * predates budget validation (no `budgetStatus` recorded), which callers treat
 * as "no budget verdict to show or enforce".
 */
export function getBudgetVerdict(raw: string | null | undefined): BudgetVerdict | null {
  const details = parseValidationResult(raw);
  if (!details || details.budgetStatus == null) return null;
  return {
    status: normalizeBudgetStatus(details.budgetStatus),
    claimed: typeof details.budgetClaimedAmount === "number" ? details.budgetClaimedAmount : null,
    reasoning: typeof details.budgetReasoning === "string" ? details.budgetReasoning : "",
  };
}
