import { RULES, isRuleKind } from "./rules";
import type {
  CriterionResult,
  CriterionSpec,
  EligibilityInput,
  EligibilityResult,
  MatchVerdict,
} from "./types";

/**
 * The deterministic eligibility engine.
 *
 * Pure, and exported separately from any database write so every rule can be
 * unit-tested without a database — the same split as `triageVerification` in
 * lib/verification-triage.ts and `computeNgoRisk` in lib/risk-engine/ngo.ts.
 *
 * NO model call is involved. This is a gate, not a ranking: the function
 * returns a verdict and the reasons behind it, never a score or an ordering.
 */

/**
 * Evaluate one organisation against one opportunity's criteria.
 *
 * Only the criteria actually declared are evaluated. A criterion that has no
 * row on the opportunity does not appear in `results` at all — which is why
 * criteria are stored as rows rather than nullable columns, and why a domestic
 * grant is never silently judged on FCRA.
 */
export function evaluateEligibility(
  input: EligibilityInput,
  criteria: CriterionSpec[]
): EligibilityResult {
  // An opportunity with no rules must not make every organisation on the
  // platform eligible. That is the same "absence reads as safe" trap the rules
  // themselves guard against, one level up — so it is closed here as well as
  // at the API, which refuses to open an opportunity with zero criteria.
  if (criteria.length === 0) {
    return {
      verdict: "UNKNOWN",
      results: [],
      summary: "This opportunity declares no criteria, so nothing was evaluated.",
    };
  }

  const results: CriterionResult[] = criteria.map((spec) => {
    if (!isRuleKind(spec.kind)) {
      // Surfaced, never dropped: a criterion nobody can evaluate is a fact the
      // admin needs, and silently ignoring it would quietly widen the gate.
      return {
        code: spec.kind,
        label: "Unrecognised criterion",
        outcome: "UNKNOWN",
        detail: `This opportunity declares "${spec.kind}", which this version of the engine does not implement.`,
        required: spec.required,
      };
    }

    const rule = RULES[spec.kind];
    const { outcome, detail } = rule.evaluate(input, spec);
    return { code: rule.kind, label: rule.label, outcome, detail, required: spec.required };
  });

  const requiredFails = results.filter((r) => r.required && r.outcome === "FAIL");
  const requiredUnknowns = results.filter((r) => r.required && r.outcome === "UNKNOWN");

  // FAIL is checked before UNKNOWN, mirroring bandFor(): we may not know
  // everything, but a definite failure is already enough to decide.
  let verdict: MatchVerdict;
  if (requiredFails.length > 0) verdict = "INELIGIBLE";
  else if (requiredUnknowns.length > 0) verdict = "UNKNOWN";
  else verdict = "ELIGIBLE";

  return { verdict, results, summary: buildSummary(verdict, results, requiredFails, requiredUnknowns) };
}

function buildSummary(
  verdict: MatchVerdict,
  results: CriterionResult[],
  requiredFails: CriterionResult[],
  requiredUnknowns: CriterionResult[]
): string {
  const total = results.length;
  const labels = (rs: CriterionResult[]) => rs.map((r) => r.label.toLowerCase()).join(", ");

  if (verdict === "ELIGIBLE") {
    const advisory = results.filter((r) => !r.required && r.outcome === "FAIL");
    const base = `Meets all ${total} required criteria.`;
    return advisory.length > 0 ? `${base} Does not meet preferred: ${labels(advisory)}.` : base;
  }

  if (verdict === "INELIGIBLE") {
    return `Fails ${requiredFails.length} of ${total} criteria: ${labels(requiredFails)}.`;
  }

  return `Could not evaluate ${requiredUnknowns.length} of ${total} criteria: ${labels(requiredUnknowns)}.`;
}
