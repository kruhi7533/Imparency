import prisma from "@/lib/prisma";
import type { RequirementStatus } from "@prisma/client";
import { averageConfidence, normalizeFields, FORM_ENTRY_AGENT } from "./provenance";
import { ERRORS, RequirementWorkflowError } from "./errors";
import { loadRequirementForActor, resolveNgoMembership, type Actor } from "./access";
import { serializeRevision } from "./dto";

export interface RequirementListItem {
  id: string;
  fileName: string;
  mimeType: string;
  hasDocument: boolean;
  isFormEntry: boolean;
  status: RequirementStatus;
  version: number;
  averageConfidence: number;
  sector: string | null;
  state: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  matchCount: number | null;
  invitedCount: number;
  responseCount: number;
  sponsor?: { name: string; email: string; companyName: string | null };
}

/**
 * Role-scoped requirement list: a donor sees only their own; an admin sees all;
 * anyone else is refused. Used by both GET /api/requirements and the pages.
 */
export async function listRequirementsForActor(actor: Actor, filter: { status?: RequirementStatus } = {}) {
  if (actor.role !== "ADMIN" && actor.role !== "DONOR") throw ERRORS.forbidden();

  const rows = await prisma.sponsorRequirement.findMany({
    where: {
      ...(actor.role === "DONOR" ? { sponsorId: actor.id } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      storageKey: true,
      extractedByAgent: true,
      status: true,
      version: true,
      extractedFields: true,
      createdAt: true,
      updatedAt: true,
      submittedAt: true,
      sponsor: actor.role === "ADMIN" ? { select: { name: true, email: true, companyName: true } } : false,
      gapReports: { orderBy: { createdAt: "desc" }, take: 1, select: { eligibleCount: true } },
      _count: { select: { responses: true, matches: { where: { invitedAt: { not: null } } } } },
    },
  });

  return rows.map((r): RequirementListItem => {
    const fields = normalizeFields(r.extractedFields);
    return {
      id: r.id,
      fileName: r.fileName,
      mimeType: r.mimeType,
      hasDocument: !!r.storageKey,
      isFormEntry: r.extractedByAgent === FORM_ENTRY_AGENT,
      status: r.status,
      version: r.version,
      averageConfidence: averageConfidence(fields),
      sector: typeof fields.sector.value === "string" ? fields.sector.value : null,
      state: typeof fields.state.value === "string" ? fields.state.value : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      matchCount: r.gapReports[0]?.eligibleCount ?? null,
      invitedCount: r._count.matches,
      responseCount: r._count.responses,
      ...(r.sponsor ? { sponsor: r.sponsor as any } : {}),
    };
  });
}

/** NGO responses for a requirement (owner/admin views). Budgets as numbers. */
export async function listResponses(requirementId: string) {
  const rows = await prisma.opportunityResponse.findMany({
    where: { requirementId },
    orderBy: { submittedAt: "asc" },
    include: {
      ngo: { select: { id: true, orgName: true, logo_url: true, healthScore: true } },
      project: { select: { id: true, title: true, targetAmount: true } },
      revisions: { orderBy: { version: "desc" } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    ngo: { id: r.ngo.id, orgName: r.ngo.orgName, logoUrl: r.ngo.logo_url, healthScore: r.ngo.healthScore === null ? null : Number(r.ngo.healthScore) },
    project: { id: r.project.id, title: r.project.title, targetAmount: Number(r.project.targetAmount) },
    proposedBudget: r.proposedBudget === null ? null : Number(r.proposedBudget),
    proposedDurationMonths: r.proposedDurationMonths,
    implementationPlan: r.implementationPlan,
    expectedOutcomes: r.expectedOutcomes,
    complianceNotes: r.complianceNotes,
    milestones: (r.milestones as any) ?? null,
    submittedAt: r.submittedAt.toISOString(),
    version: r.version,
    revisionRounds: r.revisionRounds,
    changeRequestNote: r.changeRequestNote,
    changeRequestedAt: r.changeRequestedAt ? r.changeRequestedAt.toISOString() : null,
    /** Superseded versions, newest first (SPEC-4). */
    revisions: r.revisions.map(serializeRevision),
  }));
}

/**
 * Superseded versions of one NGO proposal, newest first. Visible to the
 * requirement's owner, an admin, or the NGO that wrote the proposal — no one
 * else (another NGO gets 403, never a hint that the response exists).
 */
export async function listResponseRevisions(requirementId: string, responseId: string, actor: Actor) {
  const response = await prisma.opportunityResponse.findUnique({
    where: { id: responseId },
    select: { id: true, requirementId: true, ngoId: true },
  });
  if (actor.role === "NGO") {
    const membership = await resolveNgoMembership(actor.id);
    if (!membership || !response || response.requirementId !== requirementId || response.ngoId !== membership.ngoId) {
      throw ERRORS.forbidden();
    }
  } else {
    await loadRequirementForActor(requirementId, actor);
    if (!response || response.requirementId !== requirementId) {
      throw new RequirementWorkflowError("Proposal not found for this requirement.", 404);
    }
  }
  const rows = await prisma.opportunityResponseRevision.findMany({
    where: { responseId },
    orderBy: { version: "desc" },
  });
  return rows.map(serializeRevision);
}

export type ResponseItem = Awaited<ReturnType<typeof listResponses>>[number];

export async function listAuditTrail(requirementId: string) {
  const rows = await prisma.requirementAuditLog.findMany({
    where: { requirementId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorId: r.actorId,
    actorRole: r.actorRole,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    detail: r.detail,
    metadata: r.metadata as any,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type AuditItem = Awaited<ReturnType<typeof listAuditTrail>>[number];
