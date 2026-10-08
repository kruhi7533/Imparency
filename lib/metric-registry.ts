import type { EvidenceKind, MetricStatus, MetricUnit } from "@prisma/client";

/**
 * The Metric Registry — Week 8's governed metric definitions, and the contract
 * the NGO track consumes (Dependencies sheet: Intern 1 produces, Intern 2
 * consumes, W8).
 *
 * What it replaces: `ImpactReport.sdgTags` and `irisMetrics` are free
 * `String[]` columns, so any metric could be asserted against any project in
 * any wording, with nothing able to contradict it. `lib/impact-metrics.ts`
 * held 17 SDG names and 11 IRIS codes as flat dictionaries — useful as display
 * labels, which is why they are kept and reused here, but they are a lookup
 * table, not governance: they say what "PI4060" is called, never what counts
 * as one, what unit it is in, or what evidence would support a number.
 *
 * This module is pure. It owns the rules about what a valid metric IS; the
 * database writes live in the admin routes, and the triage that judges claims
 * against these rules lives in lib/outcome-triage.ts. Same split as
 * lib/proof-fingerprint.ts and lib/verification-triage.ts — the decision table
 * is testable with plain objects, no database required.
 *
 * NOTE: deliberately no `node:` imports. Metric labels are rendered by client
 * components, so this file is bundled for the browser — see
 * tests/client-bundle-safety.test.ts and the Week 7 regression it pins.
 */

/** The shape the registry stores and the rest of the week reasons about. */
export interface MetricDefinitionInput {
  code: string;
  name: string;
  unit: MetricUnit;
  definition: string;
  status: MetricStatus;
  sdgGoals: string[];
  irisCode: string | null;
  requiredEvidence: EvidenceKind[];
  aggregatable: boolean;
}

/**
 * Metric codes are a published contract: they appear in donor reports and in
 * the other tracks' fixtures. The format is fixed so a code cannot drift into
 * free text — `IB-<SLUG>-<NNN>`, uppercase.
 */
export const METRIC_CODE_PATTERN = /^IB-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/;

/**
 * Units whose values are meaningless to add up across projects. A portfolio
 * roll-up that summed percentages would produce "340% of beneficiaries", which
 * is the kind of number that destroys trust in every other number beside it.
 */
export const NON_AGGREGATABLE_UNITS: MetricUnit[] = ["PERCENTAGE"];

/**
 * Evidence kinds that no table backs yet.
 *
 * Declared in the enum so the registry can express the requirement, but a
 * metric requiring one can never have it satisfied — every claim against it
 * will be BLOCKED by `REQUIRED_KIND_MISSING`. That is the correct failure: it
 * refuses to approve an unprovable number rather than waving it through. Kept
 * visible here, and surfaced in the registry UI, so the gap is a known state
 * rather than a mystery for whoever meets it first.
 */
export const UNBACKED_EVIDENCE_KINDS: EvidenceKind[] = [
  "ATTENDANCE_RECORD",
  "FINANCIAL_RECORD",
];

export interface MetricValidationError {
  field: keyof MetricDefinitionInput | "status";
  message: string;
}

/**
 * Validates a metric definition.
 *
 * The load-bearing rule is the ACTIVE + empty-requiredEvidence one. §2 of
 * docs/WEEK8-BLUEPRINT.md says no number reaches a donor without evidence; a
 * metric with no required evidence kind could never fail an evidence check, so
 * it would be a permanent hole in exactly that rule — every claim against it
 * would come back CLEAN having examined nothing. Blocking it here is what makes
 * "CLEAN means checked" true by construction rather than by vigilance.
 */
export function validateMetricDefinition(
  input: MetricDefinitionInput
): MetricValidationError[] {
  const errors: MetricValidationError[] = [];

  if (!METRIC_CODE_PATTERN.test(input.code)) {
    errors.push({
      field: "code",
      message:
        "Code must look like IB-TRAINED-001 — uppercase, and ending in a three-digit number.",
    });
  }

  if (input.name.trim().length < 3) {
    errors.push({ field: "name", message: "Name is required." });
  }

  // A definition is what two different admins judge the same claim against.
  // Without it, "is 120 right?" has no shared answer.
  if (input.definition.trim().length < 20) {
    errors.push({
      field: "definition",
      message:
        "Definition must say what counts and what does not, in at least 20 characters. It is the text a reviewer judges a claim against.",
    });
  }

  if (input.status === "ACTIVE" && input.requiredEvidence.length === 0) {
    errors.push({
      field: "requiredEvidence",
      message:
        "An ACTIVE metric needs at least one required evidence kind. Without one, no claim against it could ever fail an evidence check, so every claim would pass having proved nothing.",
    });
  }

  if (input.aggregatable && NON_AGGREGATABLE_UNITS.includes(input.unit)) {
    errors.push({
      field: "aggregatable",
      message: `A ${input.unit} metric cannot be aggregatable — summing it across projects produces a meaningless total.`,
    });
  }

  // Duplicate kinds would make requiredEvidence satisfiable twice over by one
  // citation, which is not what "required" means.
  if (new Set(input.requiredEvidence).size !== input.requiredEvidence.length) {
    errors.push({
      field: "requiredEvidence",
      message: "Required evidence kinds must be distinct.",
    });
  }

  return errors;
}

/** True when a new claim may be filed against this metric. */
export function acceptsNewClaims(status: MetricStatus): boolean {
  return status === "ACTIVE";
}

/**
 * Why a metric is not accepting claims, for the UI and the API error.
 *
 * DEPRECATED is explicitly NOT a deletion: existing approved claims keep their
 * metric and keep rendering, because retracting a number a donor has already
 * been shown is a bigger problem than retiring a definition.
 */
export function claimRejectionReason(status: MetricStatus): string | null {
  if (status === "ACTIVE") return null;
  if (status === "DRAFT")
    return "This metric is still a draft. It has to be activated before numbers can be reported against it.";
  return "This metric is deprecated. Existing approved claims are unaffected, but no new ones can be filed.";
}

/** Human labels. The enum is the contract; these are only ever display text. */
export const UNIT_LABELS: Record<MetricUnit, string> = {
  COUNT_PEOPLE: "people",
  COUNT_ITEMS: "items",
  COUNT_EVENTS: "events",
  CURRENCY_INR: "₹",
  PERCENTAGE: "%",
  HOURS: "hours",
  KILOGRAMS: "kg",
  LITRES: "litres",
  AREA_SQM: "m²",
};

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  MILESTONE_PROOF: "Milestone proof",
  FIELD_PHOTO: "Field photo",
  BENEFICIARY_FEEDBACK: "Beneficiary feedback",
  ATTENDANCE_RECORD: "Attendance record",
  FINANCIAL_RECORD: "Financial record",
};

/**
 * The starter set, seeded so the NGO track has a real contract on Monday
 * rather than a fixture it has to invent and later throw away.
 *
 * Small on purpose. Five metrics that the evidence the platform actually holds
 * can substantiate — photos, milestone proofs, consented beneficiary
 * feedback — rather than an impressive catalogue of numbers nothing could
 * prove. A registry whose metrics are mostly unprovable teaches admins that
 * BLOCKED is normal and should be clicked past.
 *
 * Every definition names what does NOT count, because that is the half
 * reviewers disagree on.
 */
export const SEED_METRICS: MetricDefinitionInput[] = [
  {
    code: "IB-TRAINED-001",
    name: "Individuals trained",
    unit: "COUNT_PEOPLE",
    definition:
      "A distinct person who completed a training activity delivered under this project. Counts once per person per reporting period regardless of how many sessions they attended. Does not count registrations, invitations, or people who attended only part of a course.",
    status: "ACTIVE",
    sdgGoals: ["SDG4", "SDG8"],
    irisCode: "PI4060",
    requiredEvidence: ["MILESTONE_PROOF"],
    aggregatable: true,
  },
  {
    code: "IB-MEALS-001",
    name: "Meals provided",
    unit: "COUNT_ITEMS",
    definition:
      "One meal served to one person on one occasion. Counts each meal, so the same person on five days is five. Does not count meals prepared but not served, or dry rations distributed — those are a different metric.",
    status: "ACTIVE",
    sdgGoals: ["SDG2"],
    irisCode: "PI5669",
    requiredEvidence: ["FIELD_PHOTO"],
    aggregatable: true,
  },
  {
    code: "IB-REACHED-001",
    name: "Individuals reached",
    unit: "COUNT_PEOPLE",
    definition:
      "A distinct person who directly received a service, good, or session under this project. Counts once per person per reporting period. Does not count social-media or broadcast audiences, and does not count household members who were not themselves served.",
    status: "ACTIVE",
    sdgGoals: ["SDG1", "SDG10"],
    irisCode: "PI2822",
    requiredEvidence: ["FIELD_PHOTO", "BENEFICIARY_FEEDBACK"],
    aggregatable: true,
  },
  {
    code: "IB-ITEMS-001",
    name: "Items distributed",
    unit: "COUNT_ITEMS",
    definition:
      "A tangible good handed to a beneficiary — a kit, filter, uniform, book set, or similar. Counts the items actually handed over. Does not count items procured, in transit, or held in stock.",
    status: "ACTIVE",
    sdgGoals: ["SDG1"],
    irisCode: "PI8000",
    requiredEvidence: ["FIELD_PHOTO"],
    aggregatable: true,
  },
  {
    code: "IB-SESSIONS-001",
    name: "Sessions held",
    unit: "COUNT_EVENTS",
    definition:
      "One delivered session, class, camp, or workshop under this project. Counts the session, not its attendees. Does not count sessions scheduled and cancelled, or planning meetings among staff.",
    status: "ACTIVE",
    sdgGoals: ["SDG4"],
    irisCode: "PI1000",
    requiredEvidence: ["MILESTONE_PROOF"],
    aggregatable: true,
  },
];
