/**
 * Is this donor organisation's profile complete enough for a human to decide on?
 *
 * Pure, and exported separately from any database write so every rule can be
 * unit-tested without a database — the same split as `evaluateEligibility` in
 * lib/matching/eligibility.ts and `triageVerification` in
 * lib/verification-triage.ts.
 *
 * NO model call is involved, and none belongs here. "Does this profile have a
 * well-formed CIN" is a question with one right answer; asking a model would
 * add latency, cost and a confidence score to a regex.
 *
 * What this does NOT do is decide whether the organisation is real. That is the
 * admin's judgement and nothing here substitutes for it — a complete profile is
 * a profile worth reviewing, not an approved one.
 *
 * ─── One gate, three kinds of evidence ────────────────────────────────────
 *
 * The gate is uniform, exactly as it is for NGOs: VERIFIED or you do not fund.
 * What EARNS it differs by what kind of body this is, because the identifiers
 * differ — a company has a CIN, a trust has a registration number, and a
 * government department has neither. Requiring a CIN of everyone would have
 * locked every foundation out permanently, which is a gate nobody can pass
 * rather than a gate that works.
 */

/** Personas that can plausibly fund an opportunity rather than give to one. */
export const FUNDER_PERSONAS = ["CSR_OFFICER", "FOUNDATION", "GOVERNMENT"] as const;
export type FunderPersona = (typeof FUNDER_PERSONAS)[number];

export function isFunderPersona(value: unknown): value is FunderPersona {
  return typeof value === "string" && (FUNDER_PERSONAS as readonly string[]).includes(value);
}

/**
 * Corporate Identity Number — 21 characters, fixed shape:
 *
 *   U 99999 TG 2026 PLC 000001
 *   │ │     │  │    │   └─ 6-digit registration number
 *   │ │     │  │    └───── 3-letter company class (PLC, PTC, NPL, …)
 *   │ │     │  └────────── 4-digit year of incorporation
 *   │ │     └───────────── 2-letter state code
 *   │ └─────────────────── 5-digit industry code
 *   └───────────────────── L (listed) or U (unlisted)
 *
 * Anchored, because a partial match would accept a CIN with trailing rubbish.
 */
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

/** Uppercased and stripped of spacing, so a pasted CIN is not rejected on whitespace. */
export function normalizeCin(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\s-]/g, "").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

export function isValidCin(value: string | null | undefined): boolean {
  const normalized = normalizeCin(value);
  return normalized !== null && CIN_PATTERN.test(normalized);
}

/** The subset of a donor record this assessment reads. */
export interface FunderOrgInput {
  donorPersona: string | null;
  /** Legal name of the body — company, trust or department. */
  orgName: string | null;
  cin: string | null;
  /** Decimal in the database; accept whatever the caller has already unwrapped. */
  csrBudget: number | string | null;
  trustRegistrationId: string | null;
  trustAnnualBudget: number | string | null;
}

/** What kind of body this is, which decides which identifiers are required. */
export type FunderOrgKind = "COMPANY" | "TRUST" | "GOVERNMENT" | "NONE";

export interface FunderOrgAssessment {
  kind: FunderOrgKind;
  /** True only when every required field is present AND well-formed. */
  complete: boolean;
  /**
   * Human-readable names of what is missing, in a stable order so the message
   * an admin sees does not reshuffle between requests.
   */
  missing: string[];
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveAmount(value: number | string | null | undefined): boolean {
  if (value == null || value === "") return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function orgKindFor(persona: string | null): FunderOrgKind {
  switch (persona) {
    case "CSR_OFFICER":
      return "COMPANY";
    case "FOUNDATION":
      return "TRUST";
    case "GOVERNMENT":
      return "GOVERNMENT";
    default:
      return "NONE";
  }
}

/**
 * The required set per kind, deliberately short.
 *
 * GST and the CSR-1 registration number are useful and are displayed, but a
 * body can legitimately lack either at the point of onboarding — requiring them
 * would block real funders to no purpose, which is the same reasoning that
 * keeps a missing 12A or 80G from being treated as an NGO defect.
 *
 * GOVERNMENT asks only for a name. There is no national registry of departments
 * to check a number against, so inventing a required field would be theatre:
 * the admin's judgement IS the check, and the gate records that they made it.
 */
export function assessFunderOrg(input: FunderOrgInput): FunderOrgAssessment {
  const kind = orgKindFor(input.donorPersona);

  if (kind === "NONE") {
    // An individual or HNI donor has no organisation to verify. Reported as a
    // missing prerequisite rather than silently "complete", so the route can
    // refuse it with something an admin can act on.
    return { kind, complete: false, missing: ["an institutional donor persona (CSR, foundation or government)"] };
  }

  const missing: string[] = [];

  if (!present(input.orgName)) {
    missing.push(kind === "COMPANY" ? "company name" : "organisation name");
  }

  if (kind === "COMPANY") {
    const cin = normalizeCin(input.cin);
    if (!cin) {
      missing.push("CIN");
    } else if (!CIN_PATTERN.test(cin)) {
      // Present but malformed is a different problem from absent, and saying so
      // saves the admin from hunting for a field that is already filled in.
      missing.push("a valid CIN (21 characters, e.g. U99999TG2026PLC000001)");
    }
    if (!positiveAmount(input.csrBudget)) missing.push("annual CSR budget");
  }

  if (kind === "TRUST") {
    if (!present(input.trustRegistrationId)) missing.push("trust registration number");
    if (!positiveAmount(input.trustAnnualBudget)) missing.push("annual grant budget");
  }

  return { kind, complete: missing.length === 0, missing };
}

/**
 * Fields whose change invalidates an existing approval.
 *
 * Editing the legal name or the registration identifier after approval is not
 * an edit, it is a different organisation wearing an approved badge. Changing a
 * budget is an ordinary update and does not reopen the decision.
 */
export function identityChanged(
  before: { orgName: string | null; cin: string | null; trustRegistrationId: string | null },
  after: { orgName: string | null; cin: string | null; trustRegistrationId: string | null }
): boolean {
  const text = (v: string | null) => (v ?? "").trim().toLowerCase();
  return (
    text(before.orgName) !== text(after.orgName) ||
    normalizeCin(before.cin) !== normalizeCin(after.cin) ||
    text(before.trustRegistrationId) !== text(after.trustRegistrationId)
  );
}

export type OrgStatus = "NOT_SUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

export interface OrgStatusDecision {
  status: OrgStatus;
  /** True when this save is what pushed the profile into the review queue. */
  submitted: boolean;
  /** True when an existing approval was retired by an identity edit. */
  reopened: boolean;
}

/**
 * What a donor's own profile save does to their organisation status.
 *
 * Kept here, pure, rather than inline in the route, because the interesting
 * part is a table of cases and a table of cases is worth testing directly.
 *
 * The one thing this can never return is VERIFIED from a non-VERIFIED state:
 * an approval is a human decision and a donor editing their own profile must
 * not be able to grant themselves one. Only the admin review route writes it.
 */
export function decideOrgStatus(
  current: OrgStatus,
  before: { orgName: string | null; cin: string | null; trustRegistrationId: string | null },
  after: FunderOrgInput
): OrgStatusDecision {
  const { kind, complete } = assessFunderOrg(after);

  // Not an institution any more — there is no organisation left to have
  // verified. Switching from CSR to individual retires everything.
  if (kind === "NONE") {
    return { status: "NOT_SUBMITTED", submitted: false, reopened: current === "VERIFIED" };
  }

  if (current === "VERIFIED") {
    // An approved body that renames itself or changes its registration number
    // is not an edit — it is a different organisation wearing an approved
    // badge. The approval is retired and the decision goes back to a human.
    const identity = {
      orgName: after.orgName,
      cin: after.cin,
      trustRegistrationId: after.trustRegistrationId,
    };
    if (identityChanged(before, identity)) {
      return { status: "PENDING", submitted: false, reopened: true };
    }
    return { status: "VERIFIED", submitted: false, reopened: false };
  }

  if (complete) {
    // Covers first submission AND resubmission after a rejection: fixing what
    // the admin objected to is what puts it back in the queue.
    return { status: "PENDING", submitted: current !== "PENDING", reopened: false };
  }

  // Incomplete. A rejection stands until the donor actually fixes it — dropping
  // it to NOT_SUBMITTED would quietly erase the decision. Anything else with an
  // incomplete profile simply is not ready to be reviewed.
  return { status: current === "REJECTED" ? "REJECTED" : "NOT_SUBMITTED", submitted: false, reopened: false };
}
