import { normalizeFields, averageConfidence, FORM_ENTRY_AGENT, type RequirementFields } from "./provenance";

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

export function serializeMatchRun(report: any): MatchRunDTO {
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
    matches: (report.matches ?? []).map((m: any) => ({
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
    })),
  };
}
