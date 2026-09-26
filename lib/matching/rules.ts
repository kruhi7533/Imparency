import type { CriterionOutcome, CriterionSpec, EligibilityInput } from "./types";

/**
 * The rule table. One entry per criterion an opportunity may declare.
 *
 * Every rule is a pure function of `EligibilityInput` and its own `spec`. No
 * rule touches Prisma, the clock, or any global — `gather.ts` supplies
 * everything, including `asOf`.
 *
 * Three principles the wording and outcomes here encode, taken from CLAUDE.md:
 *
 *  1. **No evidence must never read as safe.** Where a criterion cannot be
 *     answered — nobody analysed the documents, the score was never computed,
 *     the geography was never resolved — the outcome is UNKNOWN, never PASS
 *     and never FAIL. "We could not check" is a different statement from
 *     "we checked and it failed", and collapsing the two is how a gap starts
 *     looking like a clean bill of health.
 *
 *  2. **A missing optional credential is not a defect.** Many legitimate
 *     organisations hold no 12A, 80G or FCRA. Failing such a criterion means
 *     "does not qualify for THIS opportunity" and the `detail` text must say so
 *     plainly — the rest of the admin console is an accusation surface, and
 *     this one is not.
 *
 *  3. **Eligibility has no consequences.** Nothing here writes a FraudAlert,
 *     opens a RiskReview or touches a health score. These functions are pure
 *     and structurally cannot.
 */

export const RULE_KINDS = [
  "VERIFIED_STATUS",
  "NOT_SUSPENDED",
  "CAUSE_CATEGORY",
  "COMPLIANCE_FLAG_12A",
  "COMPLIANCE_FLAG_80G",
  "FCRA_ACTIVE",
  "MIN_YEARS_ACTIVE",
  "MIN_HEALTH_SCORE",
  "HAS_ACTIVE_PROJECT",
  "PROJECT_IN_STATE",
] as const;

export type RuleKind = (typeof RULE_KINDS)[number];

export function isRuleKind(kind: string): kind is RuleKind {
  return (RULE_KINDS as readonly string[]).includes(kind);
}

export interface RuleEvaluation {
  outcome: CriterionOutcome;
  detail: string;
}

export interface RuleDefinition {
  kind: RuleKind;
  /** Shown in the criteria editor and on every result row. */
  label: string;
  /** Which field of the spec this rule reads. Removes any ambiguity. */
  param: "none" | "scalar" | "set";
  paramHint?: string;
  evaluate(input: EligibilityInput, spec: CriterionSpec): RuleEvaluation;
}

/** Case-insensitive, whitespace-tolerant comparison for untyped category text. */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

function parseThreshold(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shared by the 12A and 80G rules — the two that carry principles 1 and 2 at
 * once, and where a careless implementation gives two answers where there are
 * genuinely three.
 */
function complianceFlagRule(
  kind: "COMPLIANCE_FLAG_12A" | "COMPLIANCE_FLAG_80G",
  label: string,
  flag: "a12Verified" | "eightyGVerified",
  shortName: string
): RuleDefinition {
  return {
    kind,
    label,
    param: "none",
    evaluate(input) {
      if (input.evidence.noExtraction) {
        return {
          outcome: "UNKNOWN",
          detail:
            `Requires a validated ${shortName}. This organisation's documents have never ` +
            `been analysed, so there is nothing to check against — that is evidence ` +
            `nobody has looked, not evidence of a problem.`,
        };
      }
      if (input.evidence.earned[flag]) {
        return {
          outcome: "PASS",
          detail: `Requires a validated ${shortName}. One is on file, confirmed by an admin.`,
        };
      }
      return {
        outcome: "FAIL",
        detail:
          `Requires a validated ${shortName}. This organisation has none, so it does not ` +
          `qualify for this opportunity. Many organisations do not hold one; this is not ` +
          `a finding against them.`,
      };
    },
  };
}

export const RULES: Record<RuleKind, RuleDefinition> = {
  VERIFIED_STATUS: {
    kind: "VERIFIED_STATUS",
    label: "Verified organisation",
    param: "none",
    evaluate(input) {
      if (input.verificationStatus === "VERIFIED") {
        return { outcome: "PASS", detail: "Requires a verified organisation. This one is verified." };
      }
      return {
        outcome: "FAIL",
        detail: `Requires a verified organisation. This one is ${input.verificationStatus.toLowerCase()}.`,
      };
    },
  },

  NOT_SUSPENDED: {
    kind: "NOT_SUSPENDED",
    label: "Not suspended",
    param: "none",
    evaluate(input) {
      return input.isSuspended
        ? { outcome: "FAIL", detail: "Requires an organisation in good standing. This one is suspended." }
        : { outcome: "PASS", detail: "Requires an organisation in good standing. This one is not suspended." };
    },
  },

  CAUSE_CATEGORY: {
    kind: "CAUSE_CATEGORY",
    label: "Cause area",
    param: "set",
    paramHint: "One or more cause categories; the organisation must work in at least one.",
    evaluate(input, spec) {
      const wanted = spec.values.map(norm).filter(Boolean);
      if (wanted.length === 0) {
        return {
          outcome: "UNKNOWN",
          detail: "A cause area was required but none was specified on the opportunity.",
        };
      }

      const wantedSet = new Set(wanted);
      const orgCauses = input.causeCategories.map(norm).filter(Boolean);
      // Project categories count too: an organisation that has actually run
      // education work qualifies even if its profile list is stale.
      const projectCauses = input.projects.map((p) => norm(p.causeCategory)).filter(Boolean);
      const matched = Array.from(new Set(orgCauses.concat(projectCauses))).filter((c) => wantedSet.has(c));

      const wantedLabel = spec.values.join(", ");
      if (matched.length > 0) {
        return {
          outcome: "PASS",
          detail: `Requires work in ${wantedLabel}. This organisation works in ${matched.join(", ")}.`,
        };
      }
      if (orgCauses.length === 0 && projectCauses.length === 0) {
        return {
          outcome: "UNKNOWN",
          detail: `Requires work in ${wantedLabel}. This organisation lists no cause areas at all.`,
        };
      }
      return {
        outcome: "FAIL",
        detail:
          `Requires work in ${wantedLabel}. This organisation works in ` +
          `${input.causeCategories.join(", ") || "other areas"}.`,
      };
    },
  },

  COMPLIANCE_FLAG_12A: complianceFlagRule(
    "COMPLIANCE_FLAG_12A",
    "12A registration",
    "a12Verified",
    "12A"
  ),

  COMPLIANCE_FLAG_80G: complianceFlagRule(
    "COMPLIANCE_FLAG_80G",
    "80G tax exemption",
    "eightyGVerified",
    "80G"
  ),

  FCRA_ACTIVE: {
    kind: "FCRA_ACTIVE",
    label: "Active FCRA",
    param: "none",
    evaluate(input) {
      switch (input.fcraStatus) {
        case "ACTIVE":
          return { outcome: "PASS", detail: "Requires an active FCRA. This one is active." };
        case "EXPIRING_SOON":
          return {
            outcome: "PASS",
            detail: "Requires an active FCRA. This one is active but expires within 90 days.",
          };
        case "PENDING":
          return {
            outcome: "UNKNOWN",
            detail: "Requires an active FCRA. This one is submitted but not yet reviewed.",
          };
        case "REUPLOAD_REQUESTED":
          return {
            outcome: "UNKNOWN",
            detail: "Requires an active FCRA. A re-upload was requested and is outstanding.",
          };
        case "EXPIRED":
          return { outcome: "FAIL", detail: "Requires an active FCRA. This one has expired." };
        case "REJECTED":
          return { outcome: "FAIL", detail: "Requires an active FCRA. This one was rejected." };
        case "NONE":
        default:
          return {
            outcome: "FAIL",
            detail:
              "Requires an active FCRA. This organisation holds none, so it cannot receive " +
              "foreign contributions. Most domestic organisations do not hold one; this is " +
              "not a finding against them.",
          };
      }
    },
  },

  MIN_YEARS_ACTIVE: {
    kind: "MIN_YEARS_ACTIVE",
    label: "Years since founding",
    param: "scalar",
    paramHint: "Minimum number of years since the organisation was founded, e.g. 5.",
    evaluate(input, spec) {
      const min = parseThreshold(spec.value);
      if (min === null) {
        return { outcome: "UNKNOWN", detail: "A minimum age was required but none was specified." };
      }
      const years = input.asOf.getFullYear() - input.foundedYear;
      return years >= min
        ? { outcome: "PASS", detail: `Requires at least ${min} years since founding. This organisation has ${years}.` }
        : { outcome: "FAIL", detail: `Requires at least ${min} years since founding. This organisation has ${years}.` };
    },
  },

  MIN_HEALTH_SCORE: {
    kind: "MIN_HEALTH_SCORE",
    label: "Minimum health score",
    param: "scalar",
    paramHint: "Minimum health score out of 100, e.g. 60.",
    evaluate(input, spec) {
      const min = parseThreshold(spec.value);
      if (min === null) {
        return { outcome: "UNKNOWN", detail: "A minimum health score was required but none was specified." };
      }
      // Nullable by design on NGOProfile. A null is "never calculated", which
      // must not silently clear or silently fail a threshold.
      if (input.healthScore === null) {
        return {
          outcome: "UNKNOWN",
          detail: `Requires a health score of at least ${min}. It has never been calculated for this organisation.`,
        };
      }
      return input.healthScore >= min
        ? { outcome: "PASS", detail: `Requires a health score of at least ${min}. This organisation scores ${input.healthScore}.` }
        : { outcome: "FAIL", detail: `Requires a health score of at least ${min}. This organisation scores ${input.healthScore}.` };
    },
  },

  HAS_ACTIVE_PROJECT: {
    kind: "HAS_ACTIVE_PROJECT",
    label: "Has an active project",
    param: "none",
    evaluate(input) {
      const active = input.projects.filter((p) => p.status === "ACTIVE");
      return active.length > 0
        ? { outcome: "PASS", detail: `Requires at least one active project. This organisation has ${active.length}.` }
        : { outcome: "FAIL", detail: "Requires at least one active project. This organisation has none." };
    },
  },

  PROJECT_IN_STATE: {
    kind: "PROJECT_IN_STATE",
    label: "Has worked in state",
    param: "set",
    paramHint: "One or more states. Matched against project geography, not the organisation's address.",
    evaluate(input, spec) {
      const wanted = spec.values.map(norm).filter(Boolean);
      if (wanted.length === 0) {
        return { outcome: "UNKNOWN", detail: "A state was required but none was specified on the opportunity." };
      }
      const wantedLabel = spec.values.join(", ");

      // NGOProfile has no state/district column — only a free-text address —
      // so this criterion necessarily answers a narrower question than it
      // appears to: "has run a project we located there", not "is based there".
      if (input.projects.length === 0) {
        return {
          outcome: "UNKNOWN",
          detail: `Requires work in ${wantedLabel}. This organisation has no projects, so there is no geography on record.`,
        };
      }
      const known = input.projects.map((p) => p.stateName).filter((s): s is string => !!s);
      if (known.length === 0) {
        return {
          outcome: "UNKNOWN",
          detail: `Requires work in ${wantedLabel}. None of this organisation's projects have a resolved location.`,
        };
      }
      const wantedSet = new Set(wanted);
      const distinct = Array.from(new Set(known));
      const matched = distinct.filter((s) => wantedSet.has(norm(s)));
      return matched.length > 0
        ? { outcome: "PASS", detail: `Requires work in ${wantedLabel}. This organisation has run projects in ${matched.join(", ")}.` }
        : { outcome: "FAIL", detail: `Requires work in ${wantedLabel}. This organisation's projects are in ${distinct.join(", ")}.` };
    },
  },
};
