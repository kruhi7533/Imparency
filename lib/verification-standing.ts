/**
 * Does this organisation's evidence actually support the status it is carrying?
 *
 * "No evidence must never read as safe" is one of the platform's stated rules,
 * and until now it was enforced in exactly one place: the PENDING verification
 * queue, where an unanalysed organisation renders "Not analysed" in red. A
 * VERIFIED organisation never re-enters that queue, so its detail page rendered
 * a green VERIFIED badge and nothing else — which is the half of the rule that
 * matters least. Nobody is trusting an NGO that has not been approved yet.
 *
 * Two live examples from the dev database on 2026-09-27:
 *
 *   Anmol Vikas Trust — VERIFIED, zero ExtractedField rows, no admin action
 *                       logged for the approval. Page read clean.
 *   Tejamma           — VERIFIED with three open HIGH verification defects:
 *                       name, PAN and registration number on the documents all
 *                       disagree with the registration form. Page read clean,
 *                       and it can still receive donations.
 *
 * Both are states the front gate in app/api/admin/verify-ngo/route.ts now
 * refuses to create, and the reversal sweep in lib/verification-reversal.ts is
 * meant to catch afterwards. Neither helped here — the rows predate the gates,
 * or the sweep has not run. That is the point of this module: the page should
 * tell the truth from what is in front of it, not from whether a cron fired.
 *
 * Pure and DB-free, like deriveComplianceEvidence and triageVerification, so
 * every rule can be tested without a database.
 */

export type StandingLevel =
  /** Evidence supports the status, or the status makes no claim yet. */
  | "OK"
  /** Verified, but some evidence is still waiting on a human. */
  | "INCOMPLETE"
  /** Verified on nothing at all. The worst case, and the quietest. */
  | "UNSUPPORTED"
  /** Verified, and the evidence actively disagrees with the claim. */
  | "CONTRADICTED";

export interface VerificationStanding {
  level: StandingLevel;
  /** Shown as the banner heading. Short, and says what is wrong. */
  headline: string;
  /** One sentence: what it means, and what to do about it. */
  detail: string;
  /** Whether the page should shout. OK never does. */
  alarming: boolean;
}

export interface StandingInput {
  /** NGOProfile.verificationStatus */
  verificationStatus: string;
  /** deriveComplianceEvidence(...).noExtraction */
  noExtraction: boolean;
  /** deriveComplianceEvidence(...).outstanding.length */
  outstandingCount: number;
  /** Open, unresolved HIGH-severity verification defects. */
  openHighDefects: number;
}

const OK: VerificationStanding = {
  level: "OK",
  headline: "",
  detail: "",
  alarming: false,
};

/**
 * Deliberately says nothing about organisations that are not VERIFIED.
 *
 * A PENDING organisation with no extraction is already rendered honestly by the
 * verification queue, and repeating it here would train people to ignore the
 * banner. REJECTED makes no claim to contradict. This exists for the one case
 * nothing else covers: a live, trusted status resting on evidence that does not
 * hold it up.
 */
export function assessVerificationStanding(input: StandingInput): VerificationStanding {
  if (input.verificationStatus !== "VERIFIED") return OK;

  // Ordered worst-first. A contradiction outranks an absence: "the documents
  // say a different organisation" is a question about identity, where "we never
  // looked" is a question about process.
  if (input.openHighDefects > 0) {
    const n = input.openHighDefects;
    return {
      level: "CONTRADICTED",
      headline: `Verified, but ${n} high-severity defect${n === 1 ? "" : "s"} remain${n === 1 ? "s" : ""} open`,
      detail:
        "This organisation's documents contradict what it registered with, and it is still verified and " +
        "able to receive funds. Resolve the findings below, or re-open the verification decision.",
      alarming: true,
    };
  }

  if (input.noExtraction) {
    return {
      level: "UNSUPPORTED",
      headline: "Verified with no evidence",
      detail:
        "No document has ever been analysed for this organisation, so every compliance claim it carries " +
        "is unbacked. Run extraction and validate the fields, or re-open the verification decision.",
      alarming: true,
    };
  }

  if (input.outstandingCount > 0) {
    const n = input.outstandingCount;
    return {
      level: "INCOMPLETE",
      headline: `Verified with ${n} field${n === 1 ? "" : "s"} still awaiting review`,
      detail:
        "Extraction has run, but these fields have not been validated by a human, so they earn no " +
        "compliance flag. Not a defect — just unfinished.",
      alarming: false,
    };
  }

  return OK;
}
