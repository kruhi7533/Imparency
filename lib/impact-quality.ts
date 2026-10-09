import type { EvidenceKind, MetricStatus, MetricUnit, OutcomeClaimStatus } from "@prisma/client";
import type { FindingCode, TriageResult } from "@/lib/outcome-triage";

/**
 * Portfolio impact quality — the Week 8 defect dashboard, as a pure module.
 *
 * What it answers, in one sentence: **how much of what this platform reports is
 * actually backed by evidence?** Not "how much impact did we have" — that is
 * the organisation's claim and the thing under suspicion. This module measures
 * the gap between what is asserted and what is substantiated, which is the
 * only number that says whether the governance layer is doing anything.
 *
 * Pure, with the queries in the page, for the same reason as
 * lib/outcome-triage.ts and lib/verification-triage.ts: the arithmetic below is
 * the part worth testing exhaustively, and it has to be testable with plain
 * objects rather than through a mocked client.
 *
 * Two deliberate deviations from the wording in docs/WEEK8-BLUEPRINT.md
 * §SPEC-4, both because the obvious reading produces a number that is wrong:
 *
 *  1. **The portfolio headline is count-based, not a value sum.** "Backed value
 *     ÷ claimed value" is meaningless across metrics: adding 400,000 meals to
 *     50 people trained gives a figure in no unit, and the meals swamp the
 *     ratio entirely — a million unbacked meals would read as a catastrophe
 *     while fifty fabricated training claims rounded to nothing. The honest
 *     portfolio question is "of the N numbers we publish, how many are
 *     backed", which is unit-free. Value shares are reported PER METRIC, where
 *     the unit is constant and a sum means something.
 *  2. **APPROVED claims are re-triaged, not trusted.** The route-level gate
 *     refuses a BLOCKED claim, so an approved claim was backed *at the moment a
 *     human approved it*. Evidence can go away afterwards — a beneficiary
 *     withdraws consent, a field evidence row is un-approved. An approved claim
 *     that now triages BLOCKED is a real and serious defect, and gets its own
 *     list here. Same reasoning as the nightly sweep in
 *     lib/compliance-evidence.ts, which retracts a badge whose evidence
 *     disappeared rather than assuming a once-earned badge stays earned.
 */

/**
 * The claim statuses that count as **asserted** — a number the organisation is
 * currently standing behind, and therefore one the platform is on the hook for.
 *
 * DRAFT is excluded: nothing has been claimed yet, and counting drafts as
 * defects would punish an organisation for saving work in progress. REJECTED
 * and WITHDRAWN are excluded because they are no longer asserted — including
 * them would make the backed share *fall* every time the platform correctly
 * caught something, which inverts the metric into a measure of its own
 * diligence.
 */
export const ASSERTED_STATUSES: OutcomeClaimStatus[] = [
  "SUBMITTED",
  "NEEDS_EVIDENCE",
  "APPROVED",
];

export interface QualityClaimRow {
  id: string;
  ngoId: string;
  orgName: string;
  metricCode: string;
  metricName: string;
  unit: MetricUnit;
  /** Whether values on this metric may be summed at all. From the registry. */
  aggregatable: boolean;
  status: OutcomeClaimStatus;
  /** Decimal as a STRING, never a float (CLAUDE.md §Finance). */
  value: string;
  submittedAt: Date | null;
  /** Current verdict, recomputed. Null only when triage could not run. */
  triage: TriageResult | null;
}

// Written as BigInt() calls rather than the `0n` literal form on purpose: this
// repo's tsconfig declares no `target`, so TypeScript defaults to ES5 and
// rejects bigint literals (TS2737). Raising the target to reach nicer syntax
// here would change how every file in the project is emitted, which is not a
// trade this module gets to make.
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

/** Exact decimal arithmetic in paise, so no sum ever touches a float. */
export function toMinorUnits(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const [intPart = "0", fracPart = ""] = trimmed.replace(/^[+-]/, "").split(".");
  const frac = (fracPart + "00").slice(0, 2);
  const magnitude = BigInt(intPart || "0") * HUNDRED + BigInt(frac || "0");
  return negative ? -magnitude : magnitude;
}

/** Back to the two-decimal string a Decimal(14,2) column holds. */
export function fromMinorUnits(minor: bigint): string {
  const negative = minor < ZERO;
  const abs = negative ? -minor : minor;
  const whole = abs / HUNDRED;
  const frac = (abs % HUNDRED).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Whether a claim's number may be published.
 *
 * APPROVED *and* currently clear of blocking findings. Both halves matter: the
 * first is the human decision, the second is that the decision still holds.
 */
export function isBacked(row: QualityClaimRow): boolean {
  return row.status === "APPROVED" && row.triage !== null && row.triage.verdict !== "BLOCKED";
}

/**
 * A claim carrying a defect an admin should know about — any BLOCK or HIGH
 * finding.
 *
 * MEDIUM is excluded on purpose. PERIOD_OUTSIDE_EVIDENCE is a question to ask,
 * not an accusation, and counting it would put honest organisations on a list
 * headed "unsupported claims". Same judgement as "a missing 12A is not a
 * defect": a signal that fires on the legitimate case trains admins to dismiss
 * the whole type.
 */
export function isDefective(row: QualityClaimRow): boolean {
  if (!row.triage) return false;
  return row.triage.findings.some((f) => f.severity === "BLOCK" || f.severity === "HIGH");
}

export interface MetricQuality {
  metricCode: string;
  metricName: string;
  unit: MetricUnit;
  aggregatable: boolean;
  assertedCount: number;
  backedCount: number;
  /** Decimal strings. Null when the metric is not aggregatable. */
  assertedValue: string | null;
  backedValue: string | null;
  /** Backed ÷ asserted by value. Null when not aggregatable or nothing asserted. */
  valueShare: number | null;
  /** Backed ÷ asserted by claim count. Null when nothing asserted. */
  countShare: number | null;
}

export interface OrgQuality {
  ngoId: string;
  orgName: string;
  assertedCount: number;
  defectiveCount: number;
  /** Defective ÷ asserted. */
  rate: number;
}

export interface RetractionCandidate {
  claimId: string;
  orgName: string;
  metricCode: string;
  value: string;
  findingCodes: FindingCode[];
}

export interface PortfolioQuality {
  assertedCount: number;
  backedCount: number;
  /**
   * The headline: the share of currently-asserted numbers that are backed.
   *
   * Null when nothing is asserted — **not** 0, which on an empty pilot would
   * read as "everything we publish is unsupported". The same rule the whole
   * module enforces downstream, applied to the module's own summary.
   */
  backedShare: number | null;
  blockedCount: number;
  needsReviewCount: number;
  /** APPROVED claims whose evidence no longer supports them. */
  retractionCandidates: RetractionCandidate[];
  byMetric: MetricQuality[];
  byOrg: OrgQuality[];
  /** Asserted claims on non-aggregatable metrics, excluded from value sums. */
  nonAggregatableExcluded: number;
}

/**
 * Rolls a set of claims up into the dashboard's figures.
 *
 * Takes every claim rather than only the asserted ones, so callers cannot
 * disagree about what "asserted" means — the definition lives in exactly one
 * place, above.
 */
export function summarisePortfolio(rows: QualityClaimRow[]): PortfolioQuality {
  const asserted = rows.filter((r) => ASSERTED_STATUSES.includes(r.status));

  const backedCount = asserted.filter(isBacked).length;
  const blockedCount = asserted.filter((r) => r.triage?.verdict === "BLOCKED").length;
  const needsReviewCount = asserted.filter((r) => r.triage?.verdict === "NEEDS_REVIEW").length;

  const retractionCandidates: RetractionCandidate[] = asserted
    .filter((r) => r.status === "APPROVED" && r.triage?.verdict === "BLOCKED")
    .map((r) => ({
      claimId: r.id,
      orgName: r.orgName,
      metricCode: r.metricCode,
      value: r.value,
      findingCodes: (r.triage?.findings ?? [])
        .filter((f) => f.severity === "BLOCK")
        .map((f) => f.code),
    }));

  // --- per metric ----------------------------------------------------------
  const metricBuckets = new Map<string, QualityClaimRow[]>();
  for (const r of asserted) {
    const bucket = metricBuckets.get(r.metricCode);
    if (bucket) bucket.push(r);
    else metricBuckets.set(r.metricCode, [r]);
  }

  const byMetric: MetricQuality[] = [];
  // Array.from rather than iterating the Map directly: ES5 target again, this
  // time TS2802 (`--downlevelIteration`).
  for (const [metricCode, bucket] of Array.from(metricBuckets.entries())) {
    const first = bucket[0];
    const backed = bucket.filter(isBacked);
    const aggregatable = first.aggregatable;

    const assertedMinor = aggregatable
      ? bucket.reduce<bigint>((sum, r) => sum + toMinorUnits(r.value), ZERO)
      : null;
    const backedMinor = aggregatable
      ? backed.reduce<bigint>((sum, r) => sum + toMinorUnits(r.value), ZERO)
      : null;

    byMetric.push({
      metricCode,
      metricName: first.metricName,
      unit: first.unit,
      aggregatable,
      assertedCount: bucket.length,
      backedCount: backed.length,
      assertedValue: assertedMinor === null ? null : fromMinorUnits(assertedMinor),
      backedValue: backedMinor === null ? null : fromMinorUnits(backedMinor),
      valueShare:
        assertedMinor === null || assertedMinor === ZERO || backedMinor === null
          ? null
          : Number(backedMinor) / Number(assertedMinor),
      countShare: bucket.length === 0 ? null : backed.length / bucket.length,
    });
  }

  // Worst backing first. The dashboard exists to surface defects, so the metric
  // with the least support must not be buried alphabetically. Ties break on the
  // larger queue, then on code for a stable order across reloads.
  byMetric.sort(
    (a, b) =>
      (a.countShare ?? 1) - (b.countShare ?? 1) ||
      b.assertedCount - a.assertedCount ||
      a.metricCode.localeCompare(b.metricCode)
  );

  // --- per organisation ----------------------------------------------------
  const orgBuckets = new Map<string, QualityClaimRow[]>();
  for (const r of asserted) {
    const bucket = orgBuckets.get(r.ngoId);
    if (bucket) bucket.push(r);
    else orgBuckets.set(r.ngoId, [r]);
  }

  const byOrg: OrgQuality[] = [];
  for (const [ngoId, bucket] of Array.from(orgBuckets.entries())) {
    const defectiveCount = bucket.filter(isDefective).length;
    byOrg.push({
      ngoId,
      orgName: bucket[0].orgName,
      assertedCount: bucket.length,
      defectiveCount,
      rate: defectiveCount / bucket.length,
    });
  }

  // Highest defect rate first — but one defective claim out of one is not a
  // worse actor than eight out of ten, so volume breaks the tie and the page
  // prints the denominator beside every rate rather than ranking on the
  // percentage alone. "Repeat offenders surface without an accusation."
  byOrg.sort(
    (a, b) =>
      b.rate - a.rate || b.defectiveCount - a.defectiveCount || a.orgName.localeCompare(b.orgName)
  );

  return {
    assertedCount: asserted.length,
    backedCount,
    backedShare: asserted.length === 0 ? null : backedCount / asserted.length,
    blockedCount,
    needsReviewCount,
    retractionCandidates,
    byMetric,
    byOrg,
    nonAggregatableExcluded: asserted.filter((r) => !r.aggregatable).length,
  };
}

export interface RegistryHygiene {
  /** ACTIVE metrics nothing has ever been claimed against — a dead contract. */
  activeNeverClaimed: string[];
  /** DRAFT or DEPRECATED metrics being claimed against anyway. */
  closedBeingClaimed: string[];
  /**
   * ACTIVE metrics with no evidence rule. **Must always be empty** — SPEC-1
   * forbids it in lib/metric-registry.ts.
   *
   * It is displayed precisely *because* it must be zero: a number that can only
   * ever be zero is a regression detector, and the hole it would open — a
   * metric whose claims can never fail an evidence check — is the one thing
   * this whole module exists to close.
   */
  activeWithoutEvidenceRule: string[];
}

export function registryHygiene(
  metrics: { code: string; status: MetricStatus; requiredEvidence: EvidenceKind[] }[],
  claimedCodes: Set<string>
): RegistryHygiene {
  return {
    activeNeverClaimed: metrics
      .filter((m) => m.status === "ACTIVE" && !claimedCodes.has(m.code))
      .map((m) => m.code)
      .sort(),
    closedBeingClaimed: metrics
      .filter((m) => m.status !== "ACTIVE" && claimedCodes.has(m.code))
      .map((m) => m.code)
      .sort(),
    activeWithoutEvidenceRule: metrics
      .filter((m) => m.status === "ACTIVE" && m.requiredEvidence.length === 0)
      .map((m) => m.code)
      .sort(),
  };
}

/**
 * How one claim's number must render wherever a human or a donor sees it.
 *
 * **The load-bearing rule of Week 8's read path**, and the contract the donor
 * track consumes: an unbacked claim renders as the word "unverified" — never as
 * `0`, and never silently dropped.
 *
 * Zero is a different false statement, not a safe default. To a donor reading a
 * report, "0 people trained" says the project achieved nothing, which the
 * platform does not know and has no business asserting. Omission is worse
 * again, because then the donor cannot tell a number was ever claimed. Same
 * reasoning as "no evidence must never read as safe" in NGO verification.
 */
export type ClaimDisplay =
  | { kind: "verified"; value: string; unit: MetricUnit }
  | { kind: "unverified"; reason: string };

export function claimDisplay(row: {
  status: OutcomeClaimStatus;
  value: string;
  unit: MetricUnit;
  triage: TriageResult | null;
}): ClaimDisplay {
  if (row.status !== "APPROVED") {
    return { kind: "unverified", reason: "This figure has not completed impact review." };
  }
  if (row.triage === null) {
    // Triage could not run. "Unknown" must not collapse into "fine" — the whole
    // point of the module is that silence is not evidence.
    return { kind: "unverified", reason: "The evidence behind this figure could not be checked." };
  }
  if (row.triage.verdict === "BLOCKED") {
    return { kind: "unverified", reason: "The evidence behind this figure no longer supports it." };
  }
  return { kind: "verified", value: row.value, unit: row.unit };
}

/** 0.8137 -> "81%". Null -> an honest dash, never "0%". */
export function sharePercent(share: number | null): string {
  if (share === null) return "—";
  return `${Math.round(share * 100)}%`;
}
