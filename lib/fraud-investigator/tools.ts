import prisma from "@/lib/prisma";
import { hasDuplicateIdentity } from "@/lib/verification-triage";

/**
 * Tool implementations. Every one is read-only except file_finding, and even
 * that only appends to a RiskReview — never a status change on the NGO itself.
 *
 * PII discipline matches the deleted caseworker's: ids and the specific facts
 * needed to reason, never a stray email or phone number that outlives its use
 * in AgentStep-equivalent storage (here, FraudInvestigation.trace).
 */

export interface InvestigatorContext {
  ngoId: string;
  alertId: string | null;
}

export type ToolHandler = (args: Record<string, any>, ctx: InvestigatorContext) => Promise<any>;

export async function getAlertContext(_args: any, ctx: InvestigatorContext) {
  if (!ctx.alertId) return { note: "No specific alert — this run was started manually." };

  const alert = await prisma.fraudAlert.findUnique({ where: { id: ctx.alertId } });
  if (!alert) return { error: "Alert not found." };

  return {
    type: alert.type,
    description: alert.description,
    severity: alert.severity,
    category: alert.alertCategory,
    subType: alert.subType,
    createdAt: alert.createdAt.toISOString(),
  };
}

export async function getNgoProfile(_args: any, ctx: InvestigatorContext) {
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: ctx.ngoId },
    select: {
      orgName: true,
      panNumber: true,
      registrationNumber: true,
      foundedYear: true,
      verificationStatus: true,
      isSuspended: true,
      suspensionReason: true,
      createdAt: true,
    },
  });
  if (!ngo) return { error: "NGO not found." };

  return {
    orgName: ngo.orgName,
    panNumber: ngo.panNumber,
    registrationNumber: ngo.registrationNumber,
    foundedYear: ngo.foundedYear,
    verificationStatus: ngo.verificationStatus,
    isSuspended: ngo.isSuspended,
    suspensionReason: ngo.suspensionReason,
    accountAgeDays: Math.floor((Date.now() - ngo.createdAt.getTime()) / 86_400_000),
  };
}

export async function listNgoProjects(_args: any, ctx: InvestigatorContext) {
  const projects = await prisma.project.findMany({
    where: { ngoId: ctx.ngoId, isDeleted: false },
    select: {
      id: true,
      title: true,
      status: true,
      targetAmount: true,
      raisedAmount: true,
      createdAt: true,
      _count: { select: { donations: { where: { status: "SUCCESS" } } } },
      milestones: { select: { status: true } },
    },
  });

  return {
    projectCount: projects.length,
    projects: projects.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      targetAmount: Number(p.targetAmount),
      raisedAmount: Number(p.raisedAmount),
      donorCount: p._count.donations,
      milestonesCompleted: p.milestones.filter((m) => m.status === "COMPLETED" || m.status === "VERIFIED").length,
      milestonesTotal: p.milestones.length,
      createdAt: p.createdAt.toISOString(),
    })),
  };
}

export async function listNgoTeam(_args: any, ctx: InvestigatorContext) {
  const members = await prisma.nGOTeamMember.findMany({
    where: { ngoId: ctx.ngoId },
    select: { role: true, user: { select: { email: true } }, createdAt: true },
  });

  return {
    members: members.map((m) => ({
      role: m.role,
      email: m.user.email,
      joinedAt: m.createdAt.toISOString(),
    })),
  };
}

export async function findSharedTeamMembers(args: any, ctx: InvestigatorContext) {
  const email = typeof args.email === "string" ? args.email.trim() : "";
  if (!email) return { error: "email is required." };

  const memberships = await prisma.nGOTeamMember.findMany({
    where: { user: { email }, ngoId: { not: ctx.ngoId } },
    select: {
      role: true,
      ngo: { select: { id: true, orgName: true, verificationStatus: true, isSuspended: true } },
    },
  });

  return {
    email,
    otherNgoCount: memberships.length,
    otherNgos: memberships.map((m) => ({
      ngoId: m.ngo.id,
      orgName: m.ngo.orgName,
      role: m.role,
      verificationStatus: m.ngo.verificationStatus,
      isSuspended: m.ngo.isSuspended,
    })),
  };
}

export async function checkDuplicateIdentity(_args: any, ctx: InvestigatorContext) {
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: ctx.ngoId },
    select: { panNumber: true, registrationNumber: true },
  });
  if (!ngo) return { error: "NGO not found." };

  const hit = await hasDuplicateIdentity(ctx.ngoId, ngo.panNumber, ngo.registrationNumber);
  return { hit };
}

export async function getDonorOverlap(args: any, ctx: InvestigatorContext) {
  const otherNgoId = typeof args.otherNgoId === "string" ? args.otherNgoId : "";
  if (!otherNgoId) return { error: "otherNgoId is required." };
  if (otherNgoId === ctx.ngoId) return { error: "otherNgoId must be a different NGO." };

  const [mine, theirs] = await Promise.all([
    prisma.donation.findMany({
      where: { project: { ngoId: ctx.ngoId }, status: "SUCCESS" },
      select: { donorId: true, amount: true, createdAt: true },
    }),
    prisma.donation.findMany({
      where: { project: { ngoId: otherNgoId }, status: "SUCCESS" },
      select: { donorId: true, amount: true, createdAt: true },
    }),
  ]);

  const theirDonorIds = new Set(theirs.map((d) => d.donorId));
  const overlapping = mine.filter((d) => theirDonorIds.has(d.donorId));
  const overlapDonorIds = Array.from(new Set(overlapping.map((d) => d.donorId)));

  return {
    thisNgoDonorCount: new Set(mine.map((d) => d.donorId)).size,
    otherNgoDonorCount: theirDonorIds.size,
    overlappingDonorCount: overlapDonorIds.length,
    // Ids only — the investigator has no reason to see donor names or emails.
    sampleOverlap: overlapping.slice(0, 5).map((d) => ({
      donorId: d.donorId,
      amountToThisNgo: Number(d.amount),
      date: d.createdAt.toISOString(),
    })),
  };
}

export async function getRelatedAlerts(_args: any, ctx: InvestigatorContext) {
  const [alerts, reviews] = await Promise.all([
    prisma.fraudAlert.findMany({
      where: { entityId: ctx.ngoId, entityType: "NGO" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { type: true, description: true, severity: true, resolved: true, createdAt: true },
    }),
    prisma.riskReview.findMany({
      where: { ngoId: ctx.ngoId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { riskLevel: true, status: true, findings: true, createdAt: true },
    }),
  ]);

  return {
    alertCount: alerts.length,
    alerts: alerts.map((a) => ({
      type: a.type,
      description: a.description,
      severity: a.severity,
      resolved: a.resolved,
      at: a.createdAt.toISOString(),
    })),
    riskReviews: reviews.map((r) => ({
      riskLevel: r.riskLevel,
      status: r.status,
      findings: r.findings,
      at: r.createdAt.toISOString(),
    })),
  };
}

export async function getProofScoreHistory(_args: any, ctx: InvestigatorContext) {
  const proofs = await prisma.milestoneProof.findMany({
    where: { milestone: { project: { ngoId: ctx.ngoId } }, aiValidationScore: { not: null } },
    orderBy: { submittedAt: "asc" },
    select: { aiValidationScore: true, submittedAt: true, milestone: { select: { title: true } } },
  });

  return {
    proofCount: proofs.length,
    scores: proofs.map((p) => ({
      milestoneTitle: p.milestone.title,
      score: p.aiValidationScore,
      submittedAt: p.submittedAt.toISOString(),
    })),
  };
}

export async function getDocumentEvidence(_args: any, ctx: InvestigatorContext) {
  const [documents, fields] = await Promise.all([
    prisma.ngoDocumentAnalysis.findMany({
      where: { ngoId: ctx.ngoId },
      orderBy: { documentIndex: "asc" },
      select: {
        documentIndex: true,
        docType: true,
        docTypeConfidence: true,
        readable: true,
        note: true,
        orgNameOnDocument: true,
      },
    }),
    prisma.extractedField.findMany({
      where: { ngoId: ctx.ngoId },
      select: {
        fieldKey: true,
        extractedValue: true,
        submittedValue: true,
        matchesSubmitted: true,
        confidence: true,
        status: true,
        flags: true,
      },
    }),
  ]);

  // No rows must never read as "documents are fine" — see CLAUDE.md. An NGO
  // that registered before extraction existed, or whose run failed, looks
  // identical to a clean one unless we say so outright.
  if (documents.length === 0 && fields.length === 0) {
    return {
      analysed: false,
      note:
        "This NGO has NO document analysis on record — its documents have never been read, not read and found sound. Do not treat this as evidence that its paperwork is clean, and do not file a finding based on this absence alone.",
    };
  }

  return {
    analysed: true,
    documents: documents.map((d) => ({
      documentIndex: d.documentIndex,
      docType: d.docType,
      docTypeConfidence: d.docTypeConfidence,
      readable: d.readable,
      note: d.note,
      // Each document's own account of whose it is. Cross-document
      // disagreement is already caught deterministically by
      // findNameDisagreement in lib/verification-triage.ts; the value here is
      // comparing these names against OTHER NGOs you have surfaced.
      orgNameOnDocument: d.orgNameOnDocument,
    })),
    fields: fields.map((f) => ({
      fieldKey: f.fieldKey,
      extractedValue: f.extractedValue,
      submittedValue: f.submittedValue,
      matchesSubmitted: f.matchesSubmitted,
      confidence: f.confidence,
      // Only VALIDATED means a human confirmed it; EXTRACTED is the model's
      // own unreviewed answer (lib/compliance-evidence.ts).
      status: f.status,
      flags: f.flags,
    })),
  };
}

export const READ_TOOLS: Record<string, ToolHandler> = {
  get_alert_context: getAlertContext,
  get_ngo_profile: getNgoProfile,
  list_ngo_projects: listNgoProjects,
  list_ngo_team: listNgoTeam,
  find_shared_team_members: findSharedTeamMembers,
  check_duplicate_identity: checkDuplicateIdentity,
  get_donor_overlap: getDonorOverlap,
  get_related_alerts: getRelatedAlerts,
  get_proof_score_history: getProofScoreHistory,
  get_document_evidence: getDocumentEvidence,
};

/** Capabilities that must never exist — the threat model written down. */
export const FORBIDDEN_TOOL_NAMES = [
  "suspend_ngo",
  "reject_ngo",
  "approve_ngo",
  "resolve_alert",
  "clear_risk_review",
  "send_email",
  "delete_ngo",
  "update_ngo",
  "run_query",
  "execute_sql",
];
