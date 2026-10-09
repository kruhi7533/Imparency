/**
 * Content fingerprinting for milestone proof files — Week 7's duplicate-
 * evidence check, and the companion to the GPS provenance check in
 * lib/proof-location.ts.
 *
 * The problem it closes: before this, the same photograph could be submitted
 * as evidence against three milestones, two projects, or two different
 * organisations, and the platform would score each submission independently
 * and notice nothing. On a transparency product that is the cheapest possible
 * fraud and was the easiest possible catch.
 *
 * Same split as proof-location: the pure classification below takes plain
 * objects and is tested with plain objects, while the file reading lives in
 * the submit-proof route and the alert write lives in lib/fraud-alerts. A
 * verdict function that needed a database to answer "is this a resubmission"
 * would be untestable at the only level where the decision table matters.
 *
 * EXACT hashing, deliberately. SHA-256 catches the behaviour actually seen —
 * the same file uploaded again — with no dependency, no threshold, and a
 * deterministic answer. A perceptual hash (pHash/dHash) would additionally
 * catch a re-crop or a re-compress, but it needs a similarity threshold, and
 * there is no real submission data to tune one against yet: a field visit
 * legitimately produces dozens of near-identical frames of the same wall.
 * `contentHashes` is the seam to upgrade through — revisit it with real data,
 * the same way LOCATION_MISMATCH_THRESHOLD_KM is documented as revisitable.
 *
 * THIS MODULE MUST STAY FREE OF NODE BUILTINS. `duplicateLabel` is rendered by
 * ProofReviewClient.tsx, a "use client" component, so this file is bundled for
 * the browser. The `node:crypto` hashing that used to sit at the top now lives
 * in lib/proof-hash.ts — with it here, webpack could not build the page at all
 * (UnhandledSchemeError) and /admin/proof-review served a 500.
 */

/**
 * Where a matching file was found. Evidence reaches the platform two ways —
 * milestone proofs (/ngo submit-proof) and field captures (/ngo/field) — and a
 * check that only looked inside its own table would let the same photograph
 * cross from one to the other unseen. Both submission paths query both tables.
 */
export type EvidenceSource = "MILESTONE_PROOF" | "FIELD_EVIDENCE";

/** A prior proof that shares at least one file with the one being submitted. */
export interface PriorProofMatch {
  /** Id of the prior row — a MilestoneProof or a FieldEvidence, per `source`. */
  proofId: string;
  /** Defaults to MILESTONE_PROOF, the original and most common case. */
  source?: EvidenceSource;
  /** The evidence "slot" — see evidenceSlot(). For a milestone proof this is
   *  simply its milestone id. */
  milestoneId: string;
  milestoneTitle: string;
  projectId: string;
  ngoId: string;
  /** Null for a match inside the submitting organisation — only a cross-org
   *  collision needs the other organisation named. */
  orgName?: string | null;
}

/**
 * The slot a piece of evidence fills, which is what decides "resubmission".
 *
 * A milestone proof fills its milestone. A field capture fills its task's
 * milestone when the task has one — so a field photo later attached to that
 * same milestone's proof is a RESUBMISSION, the intended capture → proof
 * flow, and raises nothing. A field capture with no milestone fills its task.
 */
export function evidenceSlot(milestoneId: string | null | undefined, taskId?: string | null): string {
  if (milestoneId) return milestoneId;
  return `task:${taskId ?? "unknown"}`;
}

/** Where the submission being checked sits. */
export interface SubmissionContext {
  milestoneId: string;
  projectId: string;
  ngoId: string;
}

/**
 * What a collision means. Three different things, which is the whole reason
 * this is a verdict rather than a boolean:
 *
 * - RESUBMISSION — the same milestone. An organisation correcting a
 *   description, or re-uploading after a rejection, legitimately sends the
 *   same photographs again. Not suspicious, and alerting on it would train
 *   admins to ignore this alert type entirely.
 * - REUSED_IN_PROJECT — a different milestone on the same project. Could be
 *   honest (one site photo covering two deliverables) or could be a milestone
 *   claimed with last month's work. A human decides; MEDIUM.
 * - CROSS_PROJECT — a different project, or a different organisation. There is
 *   no innocent reading of one organisation's evidence appearing as another's,
 *   and little innocent reading of evidence moving between projects. HIGH.
 */
export type DuplicateVerdict = "NONE" | "RESUBMISSION" | "REUSED_IN_PROJECT" | "CROSS_PROJECT";

export interface DuplicateResult {
  verdict: DuplicateVerdict;
  /** The matches that justify the verdict — never every match. A resubmission
   *  match is dropped once a more serious one is found, so the alert text
   *  names the collision a human should actually open. */
  matches: PriorProofMatch[];
}

/**
 * Classifies prior-proof collisions against the submission being made.
 *
 * Returns the MOST serious verdict present, not a list of all of them: a batch
 * that is partly a resubmission and partly another organisation's photograph
 * is the second thing, and an alert titled with the first would bury it.
 */
export function classifyDuplicate(
  matches: PriorProofMatch[],
  context: SubmissionContext
): DuplicateResult {
  if (matches.length === 0) return { verdict: "NONE", matches: [] };

  const crossProject = matches.filter(
    (m) => m.ngoId !== context.ngoId || m.projectId !== context.projectId
  );
  if (crossProject.length > 0) return { verdict: "CROSS_PROJECT", matches: crossProject };

  const otherMilestone = matches.filter((m) => m.milestoneId !== context.milestoneId);
  if (otherMilestone.length > 0) return { verdict: "REUSED_IN_PROJECT", matches: otherMilestone };

  return { verdict: "RESUBMISSION", matches };
}

/** Severity per verdict. NONE and RESUBMISSION raise nothing at all. */
export function duplicateSeverity(verdict: DuplicateVerdict): "MEDIUM" | "HIGH" | null {
  if (verdict === "CROSS_PROJECT") return "HIGH";
  if (verdict === "REUSED_IN_PROJECT") return "MEDIUM";
  return null;
}

/**
 * The alert text.
 *
 * `createFraudAlert` dedupes on (type, entityId, description, resolved:false),
 * so the description is LOAD-BEARING: it must name the specific colliding
 * proof. Two genuinely different duplicate findings on one milestone are two
 * things to look at, and a description that said only "duplicate media found"
 * would collapse the second into the first and hide it.
 */
export function buildDuplicateDescription(result: DuplicateResult, submittedTitle: string): string {
  const [first] = result.matches;
  const others = result.matches.length - 1;
  const alsoIn = others > 0 ? ` (and ${others} other earlier proof${others > 1 ? "s" : ""})` : "";
  // Name the table, so the admin opens the right queue to find it.
  const ref = first.source === "FIELD_EVIDENCE" ? `field evidence ${first.proofId}` : `proof ${first.proofId}`;

  if (result.verdict === "CROSS_PROJECT") {
    const whose = first.orgName ? ` submitted by ${first.orgName}` : "";
    return (
      `Proof for "${submittedTitle}" reuses a file already submitted as evidence for a ` +
      `different project — milestone "${first.milestoneTitle}"${whose}, ${ref}${alsoIn}.`
    );
  }

  return (
    `Proof for "${submittedTitle}" reuses a file already submitted for milestone ` +
    `"${first.milestoneTitle}" on the same project, ${ref}${alsoIn}.`
  );
}

/**
 * Short, reviewer-facing label for a stored verdict. RESUBMISSION is
 * informational, never a warning: the same photo against the same slot is the
 * normal correct-and-resend path.
 */
export function duplicateLabel(verdict: string | null | undefined): { text: string; tone: "neutral" | "warn" | "bad" } | null {
  switch (verdict) {
    case "CROSS_PROJECT":
      return { text: "Photo already used as evidence on another project", tone: "bad" };
    case "REUSED_IN_PROJECT":
      return { text: "Photo already used for a different milestone", tone: "warn" };
    case "RESUBMISSION":
      return { text: "Same photo as an earlier submission for this milestone", tone: "neutral" };
    default:
      return null;
  }
}
