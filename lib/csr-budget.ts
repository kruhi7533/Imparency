/**
 * How much of its declared annual budget has an institutional donor actually
 * given this financial year?
 *
 * Pure, no database, so the bands can be tested directly — the same split as
 * lib/csr-verification.ts and lib/matching/eligibility.ts.
 *
 * ─── Why this never blocks a donation ─────────────────────────────────────
 *
 * Exceeding a declared CSR budget is not a compliance breach. Under §135 of
 * the Companies Act the obligation runs the other way: a company must spend at
 * least 2% of average net profit, and spending MORE than it planned is lawful
 * and common. A company that has a good year, or finds a cause it believes in,
 * raises its spend mid-year.
 *
 * So over-utilisation is a data-quality signal ("the declared figure is stale")
 * or a risk signal ("this account is moving more money than its stated
 * mandate"), and never a reason to refuse money. Refusing would stop legitimate
 * giving to enforce a number the donor typed into their own profile.
 *
 * What it is good for is telling an admin something true, which is why this
 * feeds the donor 360 view and a fraud alert rather than a gate.
 */

import { getFinancialYear } from "@/lib/finance-utils";

/**
 * Which budget field applies, per persona.
 *
 * CSR officers declare `csrBudget`; foundations declare `trustAnnualBudget`.
 * The previous check only ever read `csrBudget` and bailed out for anyone who
 * was not a CSR_OFFICER, so every foundation on the platform was exempt from a
 * check it appeared to be covered by.
 */
export function declaredAnnualBudget(input: {
  donorPersona: string | null;
  csrBudget: number | string | null;
  trustAnnualBudget: number | string | null;
}): number | null {
  const raw =
    input.donorPersona === "CSR_OFFICER"
      ? input.csrBudget
      : input.donorPersona === "FOUNDATION"
        ? input.trustAnnualBudget
        : null;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  // A zero or negative declaration is not a budget of zero, it is an absent
  // one. Treating it as zero would put every such donor permanently OVER.
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type UtilisationBand = "UNDECLARED" | "WITHIN" | "NEAR" | "OVER";

export interface BudgetUtilisation {
  band: UtilisationBand;
  /** null when no budget is declared — never 0, which would read as "spent nothing". */
  declared: number | null;
  /** Total given inside the financial year being assessed. */
  spent: number;
  /** 0-based percentage of the declared budget. null when nothing is declared. */
  percent: number | null;
  financialYear: string;
}

/** At 90% an admin should know it is close; at 100% it has gone past. */
export const NEAR_THRESHOLD = 0.9;

/**
 * Assess one donor's giving for one financial year.
 *
 * `spent` is the caller's job to total, because the query differs by context
 * (the risk check counts completed payments; the admin page counts the same
 * but is already holding them).
 */
export function assessBudgetUtilisation(input: {
  donorPersona: string | null;
  csrBudget: number | string | null;
  trustAnnualBudget: number | string | null;
  spent: number;
  asOf?: Date;
}): BudgetUtilisation {
  const financialYear = getFinancialYear(input.asOf ?? new Date());
  const declared = declaredAnnualBudget(input);
  const spent = Number.isFinite(input.spent) ? input.spent : 0;

  if (declared == null) {
    // No declaration is not "within budget". An undeclared budget is missing
    // evidence, and missing evidence must never render as a clean result.
    return { band: "UNDECLARED", declared: null, spent, percent: null, financialYear };
  }

  const percent = (spent / declared) * 100;
  const band: UtilisationBand =
    spent > declared ? "OVER" : spent >= declared * NEAR_THRESHOLD ? "NEAR" : "WITHIN";

  return { band, declared, spent, percent, financialYear };
}

/**
 * The sentence an admin reads. Kept next to the bands so the wording cannot
 * drift away from the thresholds that produced it.
 */
export function describeUtilisation(u: BudgetUtilisation): string {
  const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  switch (u.band) {
    case "UNDECLARED":
      return `No annual budget declared — ${money(u.spent)} given in ${u.financialYear} with nothing to compare it against.`;
    case "OVER":
      return `${money(u.spent)} given in ${u.financialYear} against a declared ${money(u.declared!)} — ${Math.round(u.percent!)}% of budget. Over-spending is lawful; check whether the declared figure is simply out of date.`;
    case "NEAR":
      return `${money(u.spent)} of a declared ${money(u.declared!)} for ${u.financialYear} — ${Math.round(u.percent!)}% of budget.`;
    default:
      return `${money(u.spent)} of a declared ${money(u.declared!)} for ${u.financialYear} — ${Math.round(u.percent!)}% of budget.`;
  }
}
