import prisma from "@/lib/prisma";
import { createFraudAlert } from "@/lib/fraud-alerts";
import { captureError } from "@/lib/observability";
import { FIELD_LABELS } from "@/lib/gemini/extract-ngo-fields";
import { namesMatch } from "@/lib/extraction-runner";

/**
 * Verification triage: one deterministic decision after the single extraction
 * pass. Clean NGOs are left alone; defective ones are handed to Risk &
 * Compliance with the reasons attached.
 *
 * This replaces three overlapping AI passes at registration (verifyNGODocuments,
 * screenNgo, extractNgoFields) with one pass plus this function. Triage itself
 * costs NOTHING — no model call. It reads the rows extraction already wrote and
 * applies rules a human can audit and argue with.
 *
 * The rule that keeps the risk queue usable: a MISSING 12A or 80G is not a
 * defect. Plenty of legitimate organisations have neither, and flagging them all
 * would flood the queue and make it worthless — the same failure mode as an
 * injection detector that fires on every certificate. Absence of an optional
 * certificate simply means that compliance flag is never earned.
 */

/** Fields that establish who the organisation IS. A problem here is a defect. */
const IDENTITY_FIELDS = new Set(["orgName", "registrationNumber", "panNumber"]);

/** Fields whose absence is normal and carries no risk signal. */
const OPTIONAL_FIELDS = new Set(["a12Number", "eightyGNumber"]);

export type Verdict = "SAFE" | "NEEDS_RISK_REVIEW";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface TriageFinding {
  fieldKey: string | null;
  severity: RiskLevel;
  issue: string;
}

export interface TriageResult {
  verdict: Verdict;
  riskLevel: RiskLevel;
  findings: TriageFinding[];
  /** Human-readable one-liner for the admin list. */
  summary: string;
  /**
   * What was actually checked and passed — the "why this looks safe" an admin
   * needs before approving. Stating the checks beats a confidence score: a
   * number tells you nothing about what was or wasn't examined, and an admin
   * approving on a machine verdict deserves to see its reasoning.
   */
  assurances: string[];
  /**
   * Neutral, NGO-facing wording for the fixable findings only. Null when there
   * is nothing safe to tell them — see sendNGODocumentIssueEmail.
   */
  ngoFacingIssues: string[];
}

export interface TriageInput {
  fieldKey: string;
  extractedValue: string | null;
  status: string;
  matchesSubmitted: boolean | null;
  flags: { severity: string; issue: string }[];
}

/** One document's own account of who it belongs to. */
export interface DocumentIdentity {
  documentIndex: number;
  docType: string;
  orgNameOnDocument: string | null;
}

/**
 * Do all the documents agree on whose they are?
 *
 * This exists because per-field extraction reports ONE winning value per field.
 * It reads the organisation name from whichever document it picked, matches it
 * against the registration form, and is satisfied — so an 80G certificate
 * belonging to a differently-named entity passes silently. Comparing the
 * documents against EACH OTHER is what catches that, and it costs no extra
 * model call: the names come back from the same single pass.
 *
 * Returns the disagreeing pair, or null when they agree (or when there are
 * fewer than two documents carrying a name).
 */
export function findNameDisagreement(
  documents: DocumentIdentity[]
): { a: DocumentIdentity; b: DocumentIdentity } | null {
  const named = documents.filter(
    (d) => typeof d.orgNameOnDocument === "string" && d.orgNameOnDocument.trim().length > 0
  );

  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      if (!namesMatch(named[i].orgNameOnDocument!, named[j].orgNameOnDocument!)) {
        return { a: named[i], b: named[j] };
      }
    }
  }
  return null;
}

/**
 * Text in a document that is trying to instruct whatever reads it. Certification
 * language ("this is to certify…") is normal and must never match — a detector
 * that fires on every certificate is worse than no detector.
 */
const INJECTION_MARKERS = [
  "ignore previous",
  "ignore all previous",
  "disregard the above",
  "system prompt",
  "you are an ai",
  "as an ai",
  "mark all fields",
  "you must approve",
  "do not flag",
  "set status to",
];

export function looksLikeInjection(text: string): boolean {
  const t = text.toLowerCase();
  return INJECTION_MARKERS.some((m) => t.includes(m));
}

const RANK: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

const DOC_TYPE_LABELS: Record<string, string> = {
  REGISTRATION_CERTIFICATE: "registration certificate",
  PAN_CARD: "PAN card",
  TAX_EXEMPTION_12A: "12A certificate",
  TAX_EXEMPTION_80G: "80G certificate",
  FCRA_CERTIFICATE: "FCRA certificate",
  BANK_PROOF: "bank proof",
  UNKNOWN: "unlabelled document",
};

function labelForDocType(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? "document";
}

/**
 * Pure: given the stored fields (and whether the identity is already in use by
 * another NGO), decide whether this registration is clean.
 * Exported separately from the DB write so it can be unit-tested.
 */
export function triageVerification(
  fields: TriageInput[],
  opts: {
    duplicateIdentity?: boolean;
    unreadableDocuments?: number;
    documents?: DocumentIdentity[];
  } = {}
): TriageResult {
  const findings: TriageFinding[] = [];

  // Do the documents agree with each other about whose they are? A certificate
  // naming a different entity is the pattern per-field extraction cannot see.
  const disagreement = findNameDisagreement(opts.documents ?? []);
  if (disagreement) {
    findings.push({
      fieldKey: "orgName",
      severity: "HIGH",
      issue: `Documents name different organisations: "${disagreement.a.orgNameOnDocument}" on the ${labelForDocType(disagreement.a.docType)} but "${disagreement.b.orgNameOnDocument}" on the ${labelForDocType(disagreement.b.docType)}. This can be a legitimate rename — ask for the amendment deed before deciding.`,
    });
  }

  if (opts.duplicateIdentity) {
    findings.push({
      fieldKey: null,
      severity: "HIGH",
      issue:
        "The PAN or registration number is already registered to a different organisation on the platform.",
    });
  }

  if (opts.unreadableDocuments && opts.unreadableDocuments > 0) {
    findings.push({
      fieldKey: null,
      severity: "MEDIUM",
      issue: `${opts.unreadableDocuments} uploaded document(s) could not be read.`,
    });
  }

  if (fields.length === 0) {
    findings.push({
      fieldKey: null,
      severity: "MEDIUM",
      issue: "Document analysis produced no fields at all — it may not have run.",
    });
  }

  for (const field of fields) {
    const label = FIELD_LABELS[field.fieldKey] ?? field.fieldKey;

    // A document that tries to give instructions is a fraud signal in itself,
    // regardless of what value was read out of it.
    if (field.extractedValue && looksLikeInjection(field.extractedValue)) {
      findings.push({
        fieldKey: field.fieldKey,
        severity: "HIGH",
        issue: `${label} contains text that tries to instruct the reader rather than state a value.`,
      });
      continue;
    }

    // Missing 12A/80G is normal — it costs the NGO that compliance flag and
    // nothing more. Never a risk finding.
    if (OPTIONAL_FIELDS.has(field.fieldKey) && field.extractedValue === null) continue;

    if (IDENTITY_FIELDS.has(field.fieldKey)) {
      if (field.extractedValue === null) {
        findings.push({
          fieldKey: field.fieldKey,
          severity: "MEDIUM",
          issue: `${label} could not be found in any uploaded document.`,
        });
        continue;
      }

      if (field.matchesSubmitted === false) {
        findings.push({
          fieldKey: field.fieldKey,
          severity: "HIGH",
          issue: `${label} in the documents does not match what was entered on the registration form.`,
        });
        continue;
      }
    }

    // Anything the extraction guardrails marked HIGH (bad PAN format, etc.)
    // carries through — those checks already ran in code, so triage trusts them.
    for (const flag of field.flags ?? []) {
      if (flag.severity === "HIGH") {
        findings.push({ fieldKey: field.fieldKey, severity: "HIGH", issue: flag.issue });
      }
    }
  }

  const assurances = buildAssurances(fields, opts);

  if (findings.length === 0) {
    return {
      verdict: "SAFE",
      riskLevel: "LOW",
      findings: [],
      summary: "Documents read cleanly and every identity field matches the registration form.",
      assurances,
      ngoFacingIssues: [],
    };
  }

  const riskLevel = findings.reduce<RiskLevel>(
    (worst, f) => (RANK[f.severity] > RANK[worst] ? f.severity : worst),
    "LOW"
  );

  const high = findings.filter((f) => f.severity === "HIGH").length;

  return {
    verdict: "NEEDS_RISK_REVIEW",
    riskLevel,
    findings,
    summary:
      high > 0
        ? `${findings.length} issue(s) found, ${high} serious — sent to Risk & Compliance.`
        : `${findings.length} issue(s) found — sent to Risk & Compliance.`,
    assurances,
    // A HIGH finding suppresses the whole NGO-facing message. Partial disclosure
    // ("your PAN could not be read") alongside a withheld duplicate-identity hit
    // still signals that something was noticed, which is the tell we are
    // avoiding. Silence to the NGO, everything to the admin.
    ngoFacingIssues: high > 0 ? [] : findings.map((f) => f.issue),
  };
}

/**
 * What the check actually verified. Built from the same field data the findings
 * come from, so it can never claim something that triage did not look at.
 */
function buildAssurances(
  fields: TriageInput[],
  opts: {
    duplicateIdentity?: boolean;
    unreadableDocuments?: number;
    documents?: DocumentIdentity[];
  }
): string[] {
  const out: string[] = [];
  const byKey = new Map(fields.map((f) => [f.fieldKey, f]));

  for (const key of ["orgName", "registrationNumber", "panNumber"]) {
    const f = byKey.get(key);
    if (f && f.extractedValue && f.matchesSubmitted === true) {
      out.push(`${FIELD_LABELS[key] ?? key} in the documents matches the registration form.`);
    }
  }

  const pan = byKey.get("panNumber");
  if (pan?.extractedValue && !pan.flags?.some((fl) => fl.severity === "HIGH")) {
    out.push("PAN is a valid format and passed the code-level check.");
  }

  if (opts.duplicateIdentity === false) {
    out.push("PAN and registration number are not in use by any other organisation.");
  }

  if (!opts.unreadableDocuments) {
    out.push("Every uploaded document was readable.");
  }

  const named = (opts.documents ?? []).filter((d) => d.orgNameOnDocument);
  if (named.length > 1 && !findNameDisagreement(opts.documents ?? [])) {
    out.push(`All ${named.length} documents that carry a name agree on the organisation.`);
  }

  for (const key of ["a12Number", "eightyGNumber"]) {
    const f = byKey.get(key);
    if (f?.extractedValue) {
      out.push(`${FIELD_LABELS[key] ?? key} was found in the uploaded certificates.`);
    }
  }

  return out;
}

/** Is this PAN or registration number already claimed by another NGO? */
export async function hasDuplicateIdentity(
  ngoId: string,
  panNumber: string | null,
  registrationNumber: string | null
): Promise<boolean> {
  const or: any[] = [];
  if (panNumber) or.push({ panNumber });
  if (registrationNumber) or.push({ registrationNumber });
  if (or.length === 0) return false;

  const match = await prisma.nGOProfile.findFirst({
    where: { OR: or, NOT: { id: ngoId }, isDeleted: false },
    select: { id: true },
  });
  return !!match;
}

/**
 * Applies the triage result. Clean NGOs get nothing written — the absence of a
 * RiskReview IS the "safe" state, and the extracted fields are the evidence an
 * admin approves from. Defective ones open one RiskReview and, for serious
 * findings, a FraudAlert so they surface in the existing risk queue.
 *
 * Never throws: a triage failure must not break registration, and it must never
 * make approval easier — a missing RiskReview is recoverable by re-running
 * extraction from the admin console.
 */
export async function applyTriage(ngoId: string, result: TriageResult): Promise<void> {
  if (result.verdict === "SAFE") return;

  try {
    // One open review per NGO. A re-run must update the existing case rather
    // than stack duplicates in the admin's queue.
    const existing = await prisma.riskReview.findFirst({
      where: { ngoId, status: "OPEN" },
      select: { id: true },
    });

    if (existing) {
      await prisma.riskReview.update({
        where: { id: existing.id },
        data: { riskLevel: result.riskLevel, findings: result.findings as any },
      });
    } else {
      await prisma.riskReview.create({
        data: {
          ngoId,
          riskLevel: result.riskLevel,
          findings: result.findings as any,
          status: "OPEN",
        },
      });
    }

    for (const finding of result.findings) {
      if (finding.severity !== "HIGH") continue;
      await createFraudAlert(
        "VERIFICATION_DEFECT",
        ngoId,
        "NGO",
        finding.issue,
        "HIGH",
        "DOCUMENT_ERROR"
      );
    }

    await notifyNgoOfFixableIssues(ngoId, result);
  } catch (err) {
    captureError(err, {
      scope: "lib/verification-triage",
      operation: "apply_triage",
      entityType: "NGO",
      entityId: ngoId,
      extra: { verdict: result.verdict, riskLevel: result.riskLevel },
    });
  }
}

/**
 * Tells the NGO what it can fix — and only that.
 *
 * This is the one thing in the verification path that reaches outside the
 * platform without an admin clicking, so its scope is deliberately narrow: it
 * fires only when every finding is fixable (a missing value, an unreadable
 * scan), never when something serious was found. `ngoFacingIssues` is empty in
 * that case by construction, so this function cannot leak it even if called.
 *
 * Approval and rejection emails are unchanged and still require an admin
 * decision — see app/api/admin/verify-ngo/route.ts.
 */
async function notifyNgoOfFixableIssues(ngoId: string, result: TriageResult): Promise<void> {
  if (result.ngoFacingIssues.length === 0) return;

  try {
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      select: { orgName: true, userId: true, user: { select: { email: true } } },
    });
    if (!ngo) return;

    await prisma.notification.create({
      data: {
        userId: ngo.userId,
        type: "DOCUMENT_ISSUE",
        title: "Your uploaded documents need attention",
        body: `Before verification can be completed: ${result.ngoFacingIssues.join(" ")}`,
      },
    });

    const { sendNGODocumentIssueEmail } = await import("@/lib/email");
    await sendNGODocumentIssueEmail(ngo.user.email, ngo.orgName, result.ngoFacingIssues);
  } catch (err) {
    // Best-effort: the RiskReview is the record of truth and the admin still
    // sees the case. A failed courtesy email must not break registration.
    captureError(err, {
      scope: "lib/verification-triage",
      operation: "notify_ngo",
      entityType: "NGO",
      entityId: ngoId,
    });
  }
}
