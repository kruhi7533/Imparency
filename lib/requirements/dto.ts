import { normalizeFields, averageConfidence, FORM_ENTRY_AGENT, RULE_EXTRACTION_AGENT, CLAUDE_EXTRACTION_AGENT, type RequirementFields } from "./provenance";
import { readFlags, type ExtractionFlag } from "./extraction-checks";

/** `modelVersion` of a document requirement whose details the donor typed in after extraction failed. */
export const MANUAL_ENTRY_MODEL = "manual-entry-after-failed-extraction";
import { readStoredError, type StoredExtractionError } from "./extraction-errors";

/**
 * Server → client shapes. Never include `storageKey` (private storage path) or
 * the deprecated public `rawDocumentUrl`. Raw OCR text is opt-in (owner/admin
 * detail views only). NGOs never receive these — they get an OpportunityBrief.
 */

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export interface RevisionDTO {
  id: string;
  version: number;
  fields: RequirementFields;
  changeSummary: string | null;
  changedByRole: string | null;
  changedBy: { name: string; email: string } | null;
  status: string | null;
  createdAt: string;
}

export interface RequirementDTO {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  hasDocument: boolean;
  /** Typed into the structured form rather than extracted from a document. */
  isFormEntry: boolean;
  status: string;
  /** How the fields were produced: CLAUDE / GEMINI (model), deterministic RULES, the donor FORM, or null before extraction. */
  extractionMethod: "CLAUDE" | "GEMINI" | "RULES" | "FORM" | "MANUAL" | null;
  /** Deterministic warnings (budget conflict, suspected prompt injection). */
  extractionFlags: ExtractionFlag[];
  /** Why the last extraction failed (FAILED status), as { code, message, retryable }. */
  extractionError: StoredExtractionError | null;
  version: number;
  versionNote: string | null;
  versionAuthorRole: string | null;
  fields: RequirementFields;
  averageConfidence: number;
  modelVersion: string;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  validatedAt: string | null;
  selectedProjectId: string | null;
  selectedNgoId: string | null;
  selectedAt: string | null;
  /** The proposal version the donor approved (SPEC-6). */
  selectedResponseVersion: number | null;
  createdAt: string;
  updatedAt: string;
  rawText?: string;
  sponsor?: { id: string; name: string; email: string; companyName: string | null };
  revisions?: RevisionDTO[];
}

export function serializeRequirement(req: any, opts: { includeRawText?: boolean } = {}): RequirementDTO {
  const fields = normalizeFields(req.extractedFields);
  const dto: RequirementDTO = {
    id: req.id,
    fileName: req.fileName,
    mimeType: req.mimeType,
    fileSize: req.fileSize,
    fileHash: req.fileHash,
    hasDocument: !!req.storageKey,
    isFormEntry: req.extractedByAgent === FORM_ENTRY_AGENT,
    status: req.status,
    extractionMethod:
      req.modelVersion === MANUAL_ENTRY_MODEL
        ? "MANUAL"
        : req.extractedByAgent === FORM_ENTRY_AGENT
        ? "FORM"
        : req.extractedByAgent === RULE_EXTRACTION_AGENT
        ? "RULES"
        : req.extractedByAgent === CLAUDE_EXTRACTION_AGENT
        ? "CLAUDE"
        : ["UPLOADED", "PROCESSING", "FAILED"].includes(req.status) && !Object.keys(req.extractedFields ?? {}).length
        ? null
        : "GEMINI",
    extractionFlags: readFlags(req.extractionFlags),
    extractionError: readStoredError(req.extractionError),
    version: req.version,
    versionNote: req.versionNote ?? null,
    versionAuthorRole: req.versionAuthorRole ?? null,
    fields,
    averageConfidence: averageConfidence(fields),
    modelVersion: req.modelVersion,
    reviewNote: req.reviewNote ?? null,
    submittedAt: iso(req.submittedAt),
    reviewedAt: iso(req.reviewedAt),
    validatedAt: iso(req.validatedAt),
    selectedProjectId: req.selectedProjectId ?? null,
    selectedNgoId: req.selectedNgoId ?? null,
    selectedAt: iso(req.selectedAt),
    selectedResponseVersion: req.selectedResponseVersion ?? null,
    createdAt: iso(req.createdAt)!,
    updatedAt: iso(req.updatedAt)!,
  };
  if (opts.includeRawText) dto.rawText = req.rawText ?? "";
  if (req.sponsor) {
    dto.sponsor = {
      id: req.sponsor.id,
      name: req.sponsor.name,
      email: req.sponsor.email,
      companyName: req.sponsor.companyName ?? null,
    };
  }
  if (Array.isArray(req.revisions)) {
    dto.revisions = req.revisions.map((r: any) => ({
      id: r.id,
      version: r.version,
      fields: normalizeFields(r.extractedFields),
      changeSummary: r.changeSummary ?? null,
      changedByRole: r.changedByRole ?? null,
      changedBy: r.changedBy ? { name: r.changedBy.name, email: r.changedBy.email } : null,
      status: r.status ?? null,
      createdAt: iso(r.createdAt)!,
    }));
  }
  return dto;
}

/** A superseded version of an NGO's proposal (SPEC-4). Budgets as numbers. */
export interface ResponseRevisionItem {
  version: number;
  status: string;
  proposedBudget: number | null;
  proposedDurationMonths: number | null;
  implementationPlan: string | null;
  expectedOutcomes: string | null;
  complianceNotes: string | null;
  milestones: unknown;
  submittedAt: string;
  supersededBecause: string | null;
  createdAt: string;
}

export function serializeRevision(r: any): ResponseRevisionItem {
  return {
    version: r.version,
    status: r.status,
    proposedBudget: r.proposedBudget === null || r.proposedBudget === undefined ? null : Number(r.proposedBudget),
    proposedDurationMonths: r.proposedDurationMonths ?? null,
    implementationPlan: r.implementationPlan ?? null,
    expectedOutcomes: r.expectedOutcomes ?? null,
    complianceNotes: r.complianceNotes ?? null,
    milestones: r.milestones ?? null,
    submittedAt: new Date(r.submittedAt).toISOString(),
    supersededBecause: r.supersededBecause ?? null,
    createdAt: new Date(r.createdAt).toISOString(),
  };
}

export interface MatchDTO {
  id: string;
  projectId: string;
  ngoId: string;
  projectTitle: string;
  ngoName: string;
  eligible: boolean;
  rank: number | null;
  score: number | null;
  coverage: number;
  hardEligibility: Array<{ rule: string; passed: boolean; explanation: string }>;
  dimensions: Array<{
    dimension: string;
    requirementValue: string | null;
    projectValue: string | null;
    result: string;
    weight: number;
    explanation: string;
  }>;
  gaps: Array<{ dimension: string; severity: string; description: string; recommendation: string }>;
  explanation: string;
  invitedAt: string | null;
  /** Admin shortlist review (ADM-006): APPROVED | REJECTED | null (not reviewed). */
  adminDecision: string | null;
  adminRank: number | null;
  adminNote: string | null;
}

export interface MatchRunDTO {
  id: string;
  createdAt: string;
  algorithmVersion: string | null;
  candidateCount: number;
  eligibleCount: number;
  topScore: number;
  reviewStatus: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  matches: MatchDTO[];
}

/**
 * `forDonor` drops the admin's per-candidate notes (why a specific NGO was
 * excluded), which can carry internal risk judgments about that NGO — the
 * donor sees the decision and order only (NEG-014). The run-level reviewNote
 * is addressed to the donor and stays.
 */
export function serializeMatchRun(report: any, opts: { forDonor?: boolean } = {}): MatchRunDTO {
  const internal = (v: string | null | undefined) => (opts.forDonor ? null : v ?? null);
  return {
    id: report.id,
    createdAt: iso(report.createdAt)!,
    algorithmVersion: report.algorithmVersion ?? null,
    candidateCount: report.candidateCount ?? 0,
    eligibleCount: report.eligibleCount ?? 0,
    topScore: report.overallCompatibility ?? 0,
    reviewStatus: report.reviewStatus,
    reviewNote: report.reviewNote ?? null,
    reviewedAt: iso(report.reviewedAt),
    // Once an admin has approved the shortlist, everyone sees it in the admin's
    // order: approved by adminRank, then the rest as ranked by the engine.
    matches: [...(report.matches ?? [])]
      .sort((a: any, b: any) => {
        if (report.reviewStatus !== "APPROVED") return 0;
        const ra = a.adminDecision === "APPROVED" ? a.adminRank ?? 9999 : 10000;
        const rb = b.adminDecision === "APPROVED" ? b.adminRank ?? 9999 : 10000;
        return ra - rb;
      })
      .map((m: any) => ({
      id: m.id,
      projectId: m.projectId,
      ngoId: m.ngoId,
      projectTitle: m.project?.title ?? "",
      ngoName: m.ngo?.orgName ?? "",
      eligible: m.eligible,
      rank: m.rank,
      score: m.score,
      coverage: m.coverage,
      hardEligibility: m.hardEligibility ?? [],
      dimensions: m.dimensionScores ?? [],
      gaps: m.gaps ?? [],
      explanation: m.explanation,
      invitedAt: iso(m.invitedAt),
      adminDecision: m.adminDecision ?? null,
      adminRank: m.adminRank ?? null,
      adminNote: internal(m.adminNote),
    })),
  };
}
