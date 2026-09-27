import type { RequirementFields } from "@/lib/requirements/provenance";
import { requiresFcra, requiredCertifications } from "@/lib/requirements/facts";

/**
 * Gap Diagnoser / Matching Agent — deterministic per-candidate comparison.
 *
 * Compares ONE validated requirement against ONE candidate project at a time:
 *   1. Hard eligibility rules (FCRA, required registrations, required state)
 *      run first; failing any rule excludes the candidate regardless of score.
 *   2. Soft dimensions produce MATCH / PARTIAL / MISMATCH when both sides have
 *      data, INSUFFICIENT_DATA when the candidate lacks it, NOT_APPLICABLE when
 *      the requirement does not ask for it.
 *   3. The score uses only dimensions that were genuinely compared — nothing is
 *      awarded a placeholder value. `coverage` says how much of the applicable
 *      weight had data, so a high score on thin data is visible as such.
 *
 * Every explanation is built from the structured values below; no LLM is
 * involved, so no fact can be invented. The agent ranks — it never selects.
 */

export const ALGORITHM_VERSION = "match-v2";

export type ComparisonResult = "MATCH" | "PARTIAL" | "MISMATCH" | "INSUFFICIENT_DATA" | "NOT_APPLICABLE";

/** Scoring weights (sum 100). Dimensions not listed here are shown but never scored. */
export const DIMENSION_WEIGHTS: Record<string, number> = {
  Sector: 25,
  Geography: 20,
  Budget: 20,
  "Outcome KPIs": 15,
  Duration: 10,
  "Track record": 10,
};

const RESULT_POINTS: Partial<Record<ComparisonResult, number>> = { MATCH: 1, PARTIAL: 0.5, MISMATCH: 0 };

export interface MatchRequirement {
  sector: string | null;
  state: string | null;
  district: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  durationMonths: number | null;
  expectedBeneficiaries: number | null;
  kpis: string[];
  reportingCadence: string | null;
  fcraRequired: boolean;
  requires80G: boolean;
  requires12A: boolean;
}

export interface CandidateProject {
  projectId: string;
  ngoId: string;
  ngoName: string;
  projectTitle: string;
  causeCategory: string | null;
  ngoCauseCategories: string[];
  stateName: string | null;
  districtName: string | null;
  location: string | null;
  targetAmount: number | null;
  /** Derived from the milestone schedule; null when there are no milestones. */
  durationMonths: number | null;
  /** Stated outcomes: expected outcome, problem statement, milestone titles/descriptions. */
  outcomeText: string | null;
  healthScore: number | null;
  /** Live FCRA status (expiry-derived), e.g. "ACTIVE", "EXPIRED", "NONE". */
  fcraStatus: string | null;
  eightyGVerified: boolean;
  twelveAVerified: boolean;
}

export interface DimensionOutcome {
  dimension: string;
  requirementValue: string | null;
  projectValue: string | null;
  result: ComparisonResult;
  /** Scoring weight actually applied (0 when unscored or not compared). */
  weight: number;
  explanation: string;
}

export interface HardRuleOutcome {
  rule: string;
  passed: boolean;
  explanation: string;
}

export interface Gap {
  dimension: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  recommendation: string;
}

export interface CandidateEvaluation {
  projectId: string;
  ngoId: string;
  ngoName: string;
  projectTitle: string;
  eligible: boolean;
  /** 0-100 over compared dimensions; null when ineligible or nothing could be compared. */
  score: number | null;
  /** % of applicable scoring weight that had data on both sides. */
  coverage: number;
  hardEligibility: HardRuleOutcome[];
  dimensions: DimensionOutcome[];
  gaps: Gap[];
  explanation: string;
}

// ─── Requirement facts ──────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toMatchRequirement(fields: RequirementFields): MatchRequirement {
  const certs = requiredCertifications(fields);
  const kpis = [fields.primaryKPIs.value, fields.secondaryKPIs.value]
    .flatMap((v) => (Array.isArray(v) ? v : []))
    .filter((k): k is string => typeof k === "string" && !!k.trim());
  return {
    sector: str(fields.sector.value),
    state: str(fields.state.value),
    district: str(fields.district.value),
    budgetMin: num(fields.budgetMin.value),
    budgetMax: num(fields.budgetMax.value),
    durationMonths: num(fields.durationMonths.value),
    expectedBeneficiaries: num(fields.expectedBeneficiaries.value),
    kpis,
    reportingCadence: str(fields.reportingCadence.value),
    fcraRequired: requiresFcra(fields),
    requires80G: certs.eightyG,
    requires12A: certs.twelveA,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function sameOrContains(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

function mentions(text: string | null, needle: string): boolean {
  if (!text) return false;
  return new RegExp(`\\b${norm(needle).replace(/ /g, "\\s+")}\\b`).test(norm(text));
}

export const formatINR = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const STOPWORDS = new Set([
  "with", "from", "that", "this", "their", "have", "will", "into", "over", "under", "about", "among",
  "rate", "rates", "number", "percentage", "level", "levels", "improved", "improve", "increase",
  "increased", "total", "across", "through", "within", "based",
]);

function stem(token: string): string {
  if (token.length > 5) return token.replace(/(ing|ed|es|s)$/, "");
  return token;
}

function keyTokens(text: string): string[] {
  return norm(text)
    .split(" ")
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
    .map(stem);
}

function dim(
  dimension: string,
  requirementValue: string | null,
  projectValue: string | null,
  result: ComparisonResult,
  explanation: string
): DimensionOutcome {
  const scored = result === "MATCH" || result === "PARTIAL" || result === "MISMATCH";
  return { dimension, requirementValue, projectValue, result, weight: scored ? DIMENSION_WEIGHTS[dimension] ?? 0 : 0, explanation };
}

// ─── Soft dimensions ────────────────────────────────────────────────────────

function compareSector(r: MatchRequirement, c: CandidateProject): DimensionOutcome {
  if (!r.sector) return dim("Sector", null, c.causeCategory, "NOT_APPLICABLE", "The requirement does not specify a sector.");
  if (c.causeCategory && sameOrContains(r.sector, c.causeCategory)) {
    return dim("Sector", r.sector, c.causeCategory, "MATCH", `Project is a ${c.causeCategory} project, matching the requested ${r.sector} sector.`);
  }
  const ngoMatch = c.ngoCauseCategories.find((cat) => sameOrContains(r.sector!, cat));
  if (ngoMatch) {
    return dim(
      "Sector",
      r.sector,
      c.causeCategory,
      "PARTIAL",
      `The NGO works in ${ngoMatch}, but this project is categorised as ${c.causeCategory ?? "unspecified"}.`
    );
  }
  if (!c.causeCategory && c.ngoCauseCategories.length === 0) {
    return dim("Sector", r.sector, null, "INSUFFICIENT_DATA", "The project has no cause category recorded.");
  }
  return dim("Sector", r.sector, c.causeCategory, "MISMATCH", `Project sector ${c.causeCategory} does not match the requested ${r.sector}.`);
}

/** Returns the project's state if known ("recorded" or "location text"), else null. */
function projectState(r: MatchRequirement, c: CandidateProject): { value: string; basis: string } | null {
  if (c.stateName) return { value: c.stateName, basis: "recorded" };
  if (r.state && mentions(c.location, r.state)) return { value: r.state, basis: "location text" };
  return null;
}

function compareGeography(r: MatchRequirement, c: CandidateProject): DimensionOutcome {
  const reqValue = [r.district, r.state].filter(Boolean).join(", ") || null;
  if (!r.state && !r.district) return dim("Geography", null, c.location, "NOT_APPLICABLE", "The requirement does not specify a location.");

  const projValue = [c.districtName, c.stateName].filter(Boolean).join(", ") || c.location;
  const state = projectState(r, c);

  if (r.state) {
    if (!state) {
      return dim("Geography", reqValue, projValue, "INSUFFICIENT_DATA", `The project's operating state is not recorded, so fit with ${r.state} cannot be verified.`);
    }
    if (!sameOrContains(r.state, state.value)) {
      return dim("Geography", reqValue, projValue, "MISMATCH", `Project operates in ${state.value}; the requirement is for ${r.state}.`);
    }
  }

  if (!r.district) {
    return dim("Geography", reqValue, projValue, "MATCH", `Project operates in ${r.state} (${state!.basis}).`);
  }
  if (c.districtName) {
    return sameOrContains(r.district, c.districtName)
      ? dim("Geography", reqValue, projValue, "MATCH", `Project operates in ${c.districtName}, the requested district.`)
      : dim("Geography", reqValue, projValue, "PARTIAL", `Same state, but the project is in ${c.districtName} rather than ${r.district}.`);
  }
  if (mentions(c.location, r.district)) {
    return dim("Geography", reqValue, projValue, "MATCH", `Project location mentions ${r.district}.`);
  }
  if (!r.state) {
    return dim("Geography", reqValue, projValue, "INSUFFICIENT_DATA", `The project's district is not recorded, so fit with ${r.district} cannot be verified.`);
  }
  return dim("Geography", reqValue, projValue, "PARTIAL", `State matches; the project's district is not recorded, so fit with ${r.district} is unverified.`);
}

function compareBudget(r: MatchRequirement, c: CandidateProject): DimensionOutcome {
  if (r.budgetMin === null && r.budgetMax === null) {
    return dim("Budget", null, null, "NOT_APPLICABLE", "The requirement does not specify a budget.");
  }
  const reqValue =
    r.budgetMin !== null && r.budgetMax !== null
      ? `${formatINR(r.budgetMin)} – ${formatINR(r.budgetMax)}`
      : r.budgetMax !== null
      ? `up to ${formatINR(r.budgetMax)}`
      : `at least ${formatINR(r.budgetMin!)}`;
  if (!c.targetAmount || c.targetAmount <= 0) {
    return dim("Budget", reqValue, null, "INSUFFICIENT_DATA", "The project has no funding target recorded.");
  }
  const t = c.targetAmount;
  const projValue = formatINR(t);
  const lo = r.budgetMin ?? 0;
  const hi = r.budgetMax ?? Infinity;

  if (t >= lo && t <= hi) return dim("Budget", reqValue, projValue, "MATCH", `Project target of ${projValue} is within the ${reqValue} budget.`);
  if (t > hi) {
    const share = Math.round((hi / t) * 100);
    return t <= hi * 1.5
      ? dim("Budget", reqValue, projValue, "PARTIAL", `Project target of ${projValue} exceeds the ${formatINR(hi)} maximum; the grant would cover about ${share}%.`)
      : dim("Budget", reqValue, projValue, "MISMATCH", `Project target of ${projValue} is far above the ${formatINR(hi)} maximum (the grant would cover about ${share}%).`);
  }
  return t >= lo * 0.5
    ? dim("Budget", reqValue, projValue, "PARTIAL", `Project target of ${projValue} is below the ${formatINR(lo)} minimum.`)
    : dim("Budget", reqValue, projValue, "MISMATCH", `Project target of ${projValue} is well below the ${formatINR(lo)} minimum.`);
}

function compareDuration(r: MatchRequirement, c: CandidateProject): DimensionOutcome {
  if (r.durationMonths === null) return dim("Duration", null, null, "NOT_APPLICABLE", "The requirement does not specify a duration.");
  const reqValue = `${r.durationMonths} months`;
  if (c.durationMonths === null) {
    return dim("Duration", reqValue, null, "INSUFFICIENT_DATA", "The project has no milestone schedule to derive a duration from.");
  }
  const projValue = `${c.durationMonths} months`;
  const diff = Math.abs(c.durationMonths - r.durationMonths);
  const rel = diff / Math.max(r.durationMonths, 1);
  const text = `Project duration is ${c.durationMonths} months while the requirement specifies ${r.durationMonths} months.`;
  if (diff <= 2 || rel <= 0.15) return dim("Duration", reqValue, projValue, "MATCH", `Project duration (${c.durationMonths} months) fits the ${r.durationMonths}-month requirement.`);
  if (rel <= 0.5) return dim("Duration", reqValue, projValue, "PARTIAL", text);
  return dim("Duration", reqValue, projValue, "MISMATCH", text);
}

function compareKpis(r: MatchRequirement, c: CandidateProject): { outcome: DimensionOutcome; uncovered: string[] } {
  if (r.kpis.length === 0) {
    return { outcome: dim("Outcome KPIs", null, null, "NOT_APPLICABLE", "The requirement lists no KPIs."), uncovered: [] };
  }
  const reqValue = r.kpis.join("; ");
  if (!c.outcomeText || !c.outcomeText.trim()) {
    return {
      outcome: dim("Outcome KPIs", reqValue, null, "INSUFFICIENT_DATA", "The project has no stated outcomes to compare KPIs against."),
      uncovered: r.kpis,
    };
  }
  const projectTokens = new Set(keyTokens(c.outcomeText));
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const kpi of r.kpis) {
    const tokens = keyTokens(kpi);
    const hits = tokens.filter((t) => projectTokens.has(t)).length;
    (tokens.length > 0 && hits >= Math.ceil(tokens.length / 2) ? covered : uncovered).push(kpi);
  }
  const projValue = covered.length ? `Addresses: ${covered.join("; ")}` : "No stated outcome matches";
  const method = "(keyword overlap with the project's stated outcomes and milestones)";
  if (uncovered.length === 0) {
    return { outcome: dim("Outcome KPIs", reqValue, projValue, "MATCH", `All ${r.kpis.length} KPIs appear in the project's outcomes ${method}.`), uncovered };
  }
  if (covered.length > 0) {
    return {
      outcome: dim("Outcome KPIs", reqValue, projValue, "PARTIAL", `${covered.length} of ${r.kpis.length} KPIs appear in the project's outcomes ${method}; not found: ${uncovered.join("; ")}.`),
      uncovered,
    };
  }
  return { outcome: dim("Outcome KPIs", reqValue, projValue, "MISMATCH", `None of the requested KPIs appear in the project's outcomes ${method}.`), uncovered };
}

function compareTrackRecord(c: CandidateProject): DimensionOutcome {
  if (c.healthScore === null) {
    return dim("Track record", null, null, "INSUFFICIENT_DATA", "The NGO has no health score yet (new NGO or too little delivery history).");
  }
  const projValue = `Health score ${Math.round(c.healthScore)}/100`;
  if (c.healthScore >= 70) return dim("Track record", null, projValue, "MATCH", `${projValue} indicates a strong delivery record.`);
  if (c.healthScore >= 40) return dim("Track record", null, projValue, "PARTIAL", `${projValue} indicates a moderate delivery record.`);
  return dim("Track record", null, projValue, "MISMATCH", `${projValue} indicates a weak delivery record.`);
}

// ─── Hard eligibility ───────────────────────────────────────────────────────

const FCRA_ELIGIBLE = new Set(["ACTIVE", "EXPIRING_SOON"]);

function hardRules(r: MatchRequirement, c: CandidateProject): { rules: HardRuleOutcome[]; info: DimensionOutcome[] } {
  const rules: HardRuleOutcome[] = [];
  const info: DimensionOutcome[] = [];
  const fcra = c.fcraStatus ?? "NONE";

  if (r.fcraRequired) {
    const passed = FCRA_ELIGIBLE.has(fcra);
    rules.push({
      rule: "FCRA registration",
      passed,
      explanation: passed
        ? `Requirement specifies FCRA; the NGO's FCRA registration is ${fcra.replace("_", " ").toLowerCase()}.`
        : `Requirement specifies FCRA, but the NGO's FCRA status is ${fcra}.`,
    });
    info.push(dim("FCRA", "Required", fcra, passed ? "MATCH" : "MISMATCH", rules[rules.length - 1].explanation));
  } else {
    info.push(dim("FCRA", "Not required", fcra, "NOT_APPLICABLE", "The requirement does not specify FCRA."));
  }

  const certChecks: Array<[boolean, string, boolean]> = [
    [r.requires80G, "80G registration", c.eightyGVerified],
    [r.requires12A, "12A registration", c.twelveAVerified],
  ];
  const certNotes: string[] = [];
  let anyCert = false;
  let allCertsOk = true;
  for (const [required, label, verified] of certChecks) {
    if (!required) continue;
    anyCert = true;
    allCertsOk &&= verified;
    const explanation = verified ? `${label} is verified on the platform.` : `Requirement lists ${label}, which is not verified for this NGO.`;
    rules.push({ rule: label, passed: verified, explanation });
    certNotes.push(explanation);
  }
  info.push(
    anyCert
      ? dim("Registrations", certChecks.filter(([req]) => req).map(([, l]) => l).join(", "), null, allCertsOk ? "MATCH" : "MISMATCH", certNotes.join(" "))
      : dim("Registrations", null, null, "NOT_APPLICABLE", "The requirement lists no 80G/12A registration.")
  );

  if (r.state) {
    const state = projectState(r, c);
    if (state && !sameOrContains(r.state, state.value)) {
      rules.push({ rule: "Required state", passed: false, explanation: `Requirement is limited to ${r.state}; the project operates in ${state.value}.` });
    }
  }

  return { rules, info };
}

// ─── Evaluation & ranking ───────────────────────────────────────────────────

function gapFor(d: DimensionOutcome, r: MatchRequirement, uncoveredKpis: string[]): Gap | null {
  if (d.result === "MATCH" || d.result === "NOT_APPLICABLE") return null;
  const weight = DIMENSION_WEIGHTS[d.dimension] ?? 0;
  const severity: Gap["severity"] =
    d.result === "MISMATCH" ? (weight >= 20 ? "HIGH" : "MEDIUM") : d.result === "PARTIAL" ? "MEDIUM" : "LOW";

  const rec: Record<string, string> = {
    Sector: `Confirm the NGO can deliver a ${r.sector ?? "requested"} programme.`,
    Geography: r.district ? `Confirm the NGO can operate in ${r.district}${r.state ? `, ${r.state}` : ""}.` : `Ask the NGO to confirm its operating geography.`,
    Budget:
      d.explanation.includes("exceeds") || d.explanation.includes("above")
        ? `Discuss co-funding or a scoped plan within ${r.budgetMax !== null ? formatINR(r.budgetMax) : "the budget"}.`
        : `Ask whether the NGO can scale the project${r.budgetMin !== null ? ` to at least ${formatINR(r.budgetMin)}` : ""}.`,
    Duration:
      d.result === "INSUFFICIENT_DATA"
        ? "Ask the NGO for a milestone schedule."
        : `Request a revised implementation timeline of ${r.durationMonths} months.`,
    "Outcome KPIs":
      d.result === "INSUFFICIENT_DATA"
        ? "Ask the NGO to state measurable outcomes for this project."
        : `Ask the NGO how it will measure: ${uncoveredKpis.join("; ")}.`,
    "Track record": "Review the NGO's past delivery evidence before selection.",
    FCRA: "The NGO is not FCRA-eligible and cannot receive foreign-source CSR funds.",
    Registrations: "Ask the NGO to complete registration verification on the platform.",
  };
  if (!(d.dimension in rec)) return null;
  return {
    dimension: d.dimension,
    severity,
    description: d.result === "INSUFFICIENT_DATA" ? `Missing data — ${d.explanation}` : d.explanation,
    recommendation: rec[d.dimension],
  };
}

export function evaluateCandidate(r: MatchRequirement, c: CandidateProject): CandidateEvaluation {
  const { rules, info } = hardRules(r, c);
  const kpi = compareKpis(r, c);
  const scoredDims = [compareSector(r, c), compareGeography(r, c), compareBudget(r, c), kpi.outcome, compareDuration(r, c), compareTrackRecord(c)];

  const informational: DimensionOutcome[] = [
    ...info,
    r.expectedBeneficiaries !== null
      ? dim("Beneficiaries", r.expectedBeneficiaries.toLocaleString("en-IN"), null, "INSUFFICIENT_DATA", "Projects do not record beneficiary targets, so this cannot be compared yet.")
      : dim("Beneficiaries", null, null, "NOT_APPLICABLE", "The requirement does not specify beneficiaries."),
    r.reportingCadence
      ? dim("Reporting cadence", r.reportingCadence, null, "INSUFFICIENT_DATA", "Projects do not record reporting capability, so this cannot be compared yet.")
      : dim("Reporting cadence", null, null, "NOT_APPLICABLE", "The requirement does not specify a reporting cadence."),
  ];

  const eligible = rules.every((rule) => rule.passed);
  const scoredWeight = scoredDims.reduce((s, d) => s + d.weight, 0);
  const applicableWeight = scoredDims
    .filter((d) => d.result !== "NOT_APPLICABLE")
    .reduce((s, d) => s + (DIMENSION_WEIGHTS[d.dimension] ?? 0), 0);
  const earned = scoredDims.reduce((s, d) => s + d.weight * (RESULT_POINTS[d.result] ?? 0), 0);

  const rawScore = scoredWeight > 0 ? Math.round((earned / scoredWeight) * 100) : null;
  const coverage = applicableWeight > 0 ? Math.round((scoredWeight / applicableWeight) * 100) : 0;

  const gaps: Gap[] = [
    ...rules.filter((x) => !x.passed).map((x) => ({
      dimension: x.rule,
      severity: "HIGH" as const,
      description: x.explanation,
      recommendation: "Not eligible for this requirement unless the requirement is changed.",
    })),
    ...[...scoredDims, ...info].map((d) => gapFor(d, r, kpi.uncovered)).filter((g): g is Gap => g !== null),
  ];
  const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const compared = scoredDims.filter((d) => d.weight > 0);
  const strong = compared.filter((d) => d.result === "MATCH").map((d) => d.dimension.toLowerCase());
  let explanation: string;
  if (!eligible) {
    explanation = `Not eligible: ${rules.filter((x) => !x.passed).map((x) => x.explanation).join(" ")}`;
  } else if (rawScore === null) {
    explanation = "Eligible, but no scoring criterion had data on both sides, so no score could be calculated.";
  } else {
    explanation =
      `Scored ${rawScore}/100 on ${compared.length} of ${scoredDims.length} criteria (${coverage}% of applicable weight had data).` +
      (strong.length ? ` Strong fit on ${strong.join(", ")}.` : "") +
      (gaps.length ? ` Main gap: ${gaps[0].description}` : " No gaps found.");
  }

  return {
    projectId: c.projectId,
    ngoId: c.ngoId,
    ngoName: c.ngoName,
    projectTitle: c.projectTitle,
    eligible,
    score: eligible ? rawScore : null,
    coverage,
    hardEligibility: rules,
    dimensions: [...scoredDims, ...informational],
    gaps,
    explanation,
  };
}

/**
 * Evaluates every candidate, drops hard-ineligible ones from the ranking and
 * sorts the rest: score (unscorable last) → coverage → project id (stable).
 */
export function rankCandidates(r: MatchRequirement, candidates: CandidateProject[]) {
  const evaluations = candidates.map((c) => evaluateCandidate(r, c));
  const eligible = evaluations
    .filter((e) => e.eligible)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.coverage - a.coverage || a.projectId.localeCompare(b.projectId))
    .map((e, i) => ({ ...e, rank: i + 1 }));
  const excluded = evaluations.filter((e) => !e.eligible);
  return { eligible, excluded };
}
