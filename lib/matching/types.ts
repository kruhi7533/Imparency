import type { FCRAStatus } from "@prisma/client";
import type { ComplianceEvidence } from "@/lib/compliance-evidence";

/**
 * Vocabulary for the deterministic eligibility engine.
 *
 * This module and `rules.ts` must never import `@/lib/prisma`. The engine is a
 * pure function over a flat input struct, exactly like `computeNgoRisk` in
 * lib/risk-engine/ngo.ts and `triageVerification` in lib/verification-triage.ts
 * — which is what makes every rule unit-testable without a database.
 *
 * Eligibility is a GATE, not a ranking. There is deliberately no score, no
 * ordering and no weighting anywhere in these types: a 0-100 "match score" is
 * precisely the unaccountable number that RiskScoreResult.signals exists to
 * avoid, and selection is a separate concern from eligibility.
 */

/** One criterion's answer. UNKNOWN is a first-class outcome, not a failure. */
export type CriterionOutcome = "PASS" | "FAIL" | "UNKNOWN";

/** The aggregate answer for one organisation against one opportunity. */
export type MatchVerdict = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

/**
 * A criterion as declared on the opportunity, or read back from a job's
 * `criteriaSnapshot`. Both paths produce this same shape so a historical run
 * evaluates identically to a live one.
 */
export interface CriterionSpec {
  kind: string;
  value: string | null;
  values: string[];
  /** false = evaluated and reported, but a FAIL does not reject. */
  required: boolean;
}

/**
 * One criterion's result. Shaped after `RiskSignal`: a stable machine `code`, a
 * short `label` an admin reads unaided, and a `detail` carrying the specifics.
 *
 * The UI renders this list verbatim — it IS the "why". `detail` must always
 * state BOTH the requirement and the finding, so a single line is intelligible
 * on its own out of context.
 */
export interface CriterionResult {
  /** Equals the criterion kind, so the UI can group without parsing prose. */
  code: string;
  label: string;
  outcome: CriterionOutcome;
  detail: string;
  required: boolean;
}

export interface EligibilityResult {
  verdict: MatchVerdict;
  /** Every criterion evaluated, in declaration order. Passes are included. */
  results: CriterionResult[];
  /** One line for the job list column. */
  summary: string;
}

/**
 * Everything a rule may read, gathered once per organisation.
 *
 * Flat and DB-free on purpose: `gather.ts` does the querying and the
 * Decimal/Date conversions, so a rule never touches Prisma and never reads the
 * wall clock.
 */
export interface EligibilityInput {
  ngoId: string;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  isSuspended: boolean;
  causeCategories: string[];
  foundedYear: number;

  /** 0..100, higher is BETTER. Null when never calculated — never treat as 0. */
  healthScore: number | null;

  /**
   * From `deriveComplianceEvidence`, NOT from `NGOCompliance.*Verified`.
   * A flag column can be set with no validated field behind it — that is the
   * bug `revokeUnbackedFlags` exists to retract — and one of those must never
   * win a grant.
   */
  evidence: ComplianceEvidence;

  /** Live-derived via `deriveFcraStatus`; the stored column goes stale. */
  fcraStatus: FCRAStatus;

  /**
   * NGOProfile carries no state/district column — only a free-text address —
   * so any geographic rule must route through projects and say so.
   */
  projects: {
    id: string;
    status: string;
    causeCategory: string;
    stateName: string | null;
  }[];

  /** Injected so year-based rules are testable and not wall-clock dependent. */
  asOf: Date;
}
