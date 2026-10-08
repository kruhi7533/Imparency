import type { EvidenceKind, MetricStatus, MetricUnit } from "@prisma/client";

/**
 * Outcome triage — the admin-side intelligence layer for Week 8.
 *
 * What it is for: an admin looking at "120 individuals trained" has to decide
 * whether the citations behind it actually support 120. Done by hand that is
 * slow, inconsistent between reviewers, and impossible across a portfolio —
 * nobody checks by eye whether a photo cited here was already counted on a
 * different project last month. This module does that checking and hands the
 * admin a short list of sentences instead of a research task.
 *
 * NO MODEL CALL, deliberately, and for the same reasons written down in
 * lib/verification-triage.ts: the verdict has to be identical every time,
 * explainable in one sentence, and testable with plain objects. An LLM asked
 * whether 120 is supported by 40 photographs would be slower, non-reproducible,
 * and occasionally confidently wrong — on a number that goes to a funder.
 * Everything below is arithmetic and set membership.
 *
 * Pure: plain objects in, findings out. The queries that gather the input live
 * in the admin route; the decision table lives here so it can be tested
 * exhaustively. Same split as proof-fingerprint and verification-triage.
 */

export type FindingSeverity = "BLOCK" | "HIGH" | "MEDIUM";

export type FindingCode =
  | "METRIC_NOT_ACTIVE"
  | "UNIT_MISMATCH"
  | "NO_EVIDENCE_CITED"
  | "EVIDENCE_NOT_APPROVED"
  | "REQUIRED_KIND_MISSING"
  | "DOUBLE_COUNTED"
  | "DUPLICATE_SOURCE_EVIDENCE"
  | "CONSENT_MISSING"
  | "CLAIM_EXCEEDS_EVIDENCE"
  | "PERIOD_OUTSIDE_EVIDENCE";

export interface TriageFinding {
  code: FindingCode;
  severity: FindingSeverity;
  /** One sentence an admin can act on. Ids, never names — these are rendered
   *  in the console and summarised into the audit log. */
  message: string;
}

/**
 * A citation, with the facts about the cited row already resolved by the
 * caller. Flattened on purpose: the triage must not care which of three tables
 * a piece of evidence came from, only what is true about it.
 */
export interface ResolvedCitation {
  citationId: string;
  kind: EvidenceKind;
  /** Id of the underlying evidence row, whichever table it is in. */
  evidenceRef: string;
  /** False when the row exists but no human has approved it yet. */
  approved: boolean;
  /** Week 7's verdict on the file's provenance, when the row carries one.
   *  Null means "not fingerprinted" — which is NOT the same as clean. */
  duplicateVerdict: string | null;
  /** When the evidence was captured in the field. */
  capturedAt: Date | null;
  /** BENEFICIARY_FEEDBACK only: consent to record, and whether it was
   *  withdrawn. Undefined for kinds where consent does not apply. */
  consentToRecord?: boolean;
  consentWithdrawn?: boolean;
}

export interface TriageInput {
  claim: {
    id: string;
    /** Decimal as a STRING. Never a float: an impact figure is quoted to
     *  funders and gets the same treatment as a rupee amount (CLAUDE.md
     *  §Finance). Comparisons below are done on the decimal string. */
    value: string;
    unit: MetricUnit;
    periodStart: Date;
    periodEnd: Date;
  };
  metric: {
    code: string;
    unit: MetricUnit;
    status: MetricStatus;
    requiredEvidence: EvidenceKind[];
  };
  citations: ResolvedCitation[];
  /**
   * Evidence refs already cited by a DIFFERENT **approved** claim on the SAME
   * metric. Gathered by the caller in one indexed query over
   * OutcomeClaimEvidence.
   *
   * Same metric is the key qualifier. One photograph can legitimately evidence
   * both "meals provided" and "sessions held" — those are different facts about
   * one event. The same photograph evidencing "meals provided" twice is the
   * same meal counted twice.
   */
  evidenceCitedByApprovedClaims: Set<string>;
}

export type TriageVerdict = "CLEAN" | "NEEDS_REVIEW" | "BLOCKED";

export interface TriageResult {
  verdict: TriageVerdict;
  findings: TriageFinding[];
}

/**
 * Compares a decimal string against a non-negative integer bound without
 * going through a float.
 *
 * Returns true when `value` is strictly greater than `bound`. Only the integer
 * part decides unless it ties, in which case any non-zero fraction tips it —
 * so "40.00" does not exceed 40 but "40.01" does.
 */
export function decimalExceeds(value: string, bound: number): boolean {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  if (negative) return false; // a negative claim never exceeds a count bound
  const [intPart = "0", fracPart = ""] = trimmed.replace(/^\+/, "").split(".");
  const intDigits = intPart.replace(/^0+(?=\d)/, "");
  const boundDigits = String(bound);
  if (intDigits.length !== boundDigits.length) {
    return intDigits.length > boundDigits.length;
  }
  if (intDigits !== boundDigits) return intDigits > boundDigits;
  return /[1-9]/.test(fracPart);
}

/**
 * Whether the number claimed can be bounded by counting citations.
 *
 * This is deliberately NARROW, and the narrowness is the point. One
 * photograph of a distribution does not tell you whether 50 or 500 meals were
 * served, so "claimed value must not exceed the number of photos" would be a
 * fabricated rule that fires constantly on honest claims — and an alert that
 * fires on honest claims trains admins to dismiss the type, which is how the
 * 12A rule in NGO verification was reasoned about too.
 *
 * There is exactly one defensible correspondence in the data the platform
 * holds today: a beneficiary feedback row is one identified beneficiary
 * attesting for themselves. So when a metric counts PEOPLE *and* requires
 * BENEFICIARY_FEEDBACK, the number of consented feedback citations is a real
 * upper bound on how many people can be claimed.
 *
 * Anything else returns null — no bound, no finding. An honest "cannot tell"
 * beats an invented number.
 */
export function evidenceUpperBound(
  metric: TriageInput["metric"],
  citations: ResolvedCitation[]
): number | null {
  const countsPeople = metric.unit === "COUNT_PEOPLE";
  const needsFeedback = metric.requiredEvidence.includes("BENEFICIARY_FEEDBACK");
  if (!countsPeople || !needsFeedback) return null;

  return citations.filter(
    (c) =>
      c.kind === "BENEFICIARY_FEEDBACK" &&
      c.approved &&
      c.consentToRecord === true &&
      c.consentWithdrawn !== true
  ).length;
}

/**
 * Judges one outcome claim.
 *
 * Order matters only for readability — the verdict is derived from the set of
 * severities, not from the first finding. Every applicable rule reports, so an
 * admin sees all of what is wrong in one pass rather than fixing one thing to
 * reveal the next.
 */
export function triageOutcomeClaim(input: TriageInput): TriageResult {
  const { claim, metric, citations, evidenceCitedByApprovedClaims } = input;
  const findings: TriageFinding[] = [];

  // --- the metric itself ----------------------------------------------------
  if (metric.status !== "ACTIVE") {
    findings.push({
      code: "METRIC_NOT_ACTIVE",
      severity: "BLOCK",
      message:
        metric.status === "DRAFT"
          ? `Metric ${metric.code} is still a draft and is not open for claims.`
          : `Metric ${metric.code} is deprecated and is not open for new claims.`,
    });
  }

  // The claim snapshots its unit at submission, so a drift here means the
  // metric was edited underneath it — the number no longer means what the
  // registry says it means.
  if (claim.unit !== metric.unit) {
    findings.push({
      code: "UNIT_MISMATCH",
      severity: "BLOCK",
      message: `Claim is in ${claim.unit} but metric ${metric.code} is defined in ${metric.unit}.`,
    });
  }

  // --- citations exist and are real evidence --------------------------------
  if (citations.length === 0) {
    // This is also what stops CLEAN from ever meaning "nothing was examined".
    findings.push({
      code: "NO_EVIDENCE_CITED",
      severity: "BLOCK",
      message: "No evidence is cited. A reported number cannot be approved on its own assertion.",
    });
  }

  const unapproved = citations.filter((c) => !c.approved);
  if (unapproved.length > 0) {
    findings.push({
      code: "EVIDENCE_NOT_APPROVED",
      severity: "BLOCK",
      message:
        `${unapproved.length} cited item(s) have not been approved in evidence review ` +
        `(${unapproved.map((c) => c.evidenceRef).join(", ")}). Unreviewed evidence is not evidence.`,
    });
  }

  // --- the metric's own evidence rule --------------------------------------
  // Only APPROVED citations can satisfy a requirement; otherwise an NGO could
  // satisfy it by citing something nobody has looked at.
  const approvedKinds = new Set(citations.filter((c) => c.approved).map((c) => c.kind));
  const missingKinds = metric.requiredEvidence.filter((k) => !approvedKinds.has(k));
  if (missingKinds.length > 0) {
    findings.push({
      code: "REQUIRED_KIND_MISSING",
      severity: "BLOCK",
      message:
        `Metric ${metric.code} requires approved ${missingKinds.join(", ")} evidence, ` +
        `and none is cited.`,
    });
  }

  // --- double counting: the headline check ---------------------------------
  const doubleCounted = citations.filter((c) =>
    evidenceCitedByApprovedClaims.has(c.evidenceRef)
  );
  if (doubleCounted.length > 0) {
    findings.push({
      code: "DOUBLE_COUNTED",
      severity: "HIGH",
      message:
        `${doubleCounted.length} cited item(s) are already counted by an approved claim on ` +
        `metric ${metric.code} (${doubleCounted.map((c) => c.evidenceRef).join(", ")}). ` +
        `Approving this would count the same work twice.`,
    });
  }

  // --- provenance carried over from Week 7 ---------------------------------
  // A file that was already flagged as reused evidence should not quietly
  // become a number. RESUBMISSION is excluded: re-uploading the same photo for
  // the same milestone is the intended correct-and-resend path.
  const taintedProvenance = citations.filter(
    (c) =>
      c.duplicateVerdict === "CROSS_PROJECT" || c.duplicateVerdict === "REUSED_IN_PROJECT"
  );
  if (taintedProvenance.length > 0) {
    findings.push({
      code: "DUPLICATE_SOURCE_EVIDENCE",
      severity: "HIGH",
      message:
        `${taintedProvenance.length} cited item(s) were flagged in evidence review as a reused ` +
        `file (${taintedProvenance.map((c) => `${c.evidenceRef}:${c.duplicateVerdict}`).join(", ")}).`,
    });
  }

  // --- consent ------------------------------------------------------------
  // A beneficiary who never consented, or who withdrew, must not become a
  // statistic. Withdrawal already hides the photo from donors (Week 7); it has
  // to invalidate the citation too, or the number outlives the consent.
  const consentProblems = citations.filter(
    (c) =>
      c.kind === "BENEFICIARY_FEEDBACK" &&
      (c.consentToRecord === false || c.consentWithdrawn === true)
  );
  if (consentProblems.length > 0) {
    findings.push({
      code: "CONSENT_MISSING",
      severity: "HIGH",
      message:
        `${consentProblems.length} cited beneficiary record(s) have no recorded consent or have ` +
        `had it withdrawn (${consentProblems.map((c) => c.evidenceRef).join(", ")}).`,
    });
  }

  // --- arithmetic ---------------------------------------------------------
  const bound = evidenceUpperBound(metric, citations);
  if (bound !== null && decimalExceeds(claim.value, bound)) {
    findings.push({
      code: "CLAIM_EXCEEDS_EVIDENCE",
      severity: "HIGH",
      message:
        `Claim of ${claim.value} exceeds what the citations support: ${bound} consented ` +
        `beneficiary record(s) are cited, and each attests one person.`,
    });
  }

  // --- period coherence ---------------------------------------------------
  // Evidence captured outside the reporting period is not necessarily wrong —
  // a photo taken two days after period end may well document period work —
  // so this is MEDIUM and never blocks. It is a question to ask, not a verdict.
  const outsidePeriod = citations.filter(
    (c) => c.capturedAt !== null && (c.capturedAt < claim.periodStart || c.capturedAt > claim.periodEnd)
  );
  if (outsidePeriod.length > 0) {
    findings.push({
      code: "PERIOD_OUTSIDE_EVIDENCE",
      severity: "MEDIUM",
      message:
        `${outsidePeriod.length} cited item(s) were captured outside the claim's reporting ` +
        `period (${outsidePeriod.map((c) => c.evidenceRef).join(", ")}).`,
    });
  }

  return { verdict: verdictFor(findings), findings };
}

/**
 * Verdict from the set of severities.
 *
 * CLEAN is only reachable when nothing fired at all — and because
 * NO_EVIDENCE_CITED blocks an empty citation list, and SPEC-1 forbids an ACTIVE
 * metric with no required evidence, CLEAN cannot mean "no evidence was
 * examined". That is the same rule as "no evidence must never read as safe" in
 * NGO verification, enforced structurally instead of by convention.
 */
export function verdictFor(findings: TriageFinding[]): TriageVerdict {
  if (findings.some((f) => f.severity === "BLOCK")) return "BLOCKED";
  if (findings.length > 0) return "NEEDS_REVIEW";
  return "CLEAN";
}

/** Reviewer-facing label for a verdict. */
export function verdictLabel(
  verdict: TriageVerdict
): { text: string; tone: "good" | "warn" | "bad" } {
  switch (verdict) {
    case "CLEAN":
      return { text: "Evidence checks passed", tone: "good" };
    case "NEEDS_REVIEW":
      return { text: "Needs your judgement", tone: "warn" };
    case "BLOCKED":
      return { text: "Cannot be approved", tone: "bad" };
  }
}
