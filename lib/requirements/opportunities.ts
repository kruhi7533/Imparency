import prisma from "@/lib/prisma";
import { commitRequirementChange } from "./commit";
import { recordRequirementEvent } from "./audit";
import { ERRORS, RequirementWorkflowError } from "./errors";
import { normalizeFields } from "./provenance";
import { buildOpportunityBrief, type OpportunityBrief } from "./sanitize";
import { resolveNgoMembership, type Actor } from "./access";

/**
 * NGO side of the CSR workflow. An NGO can see an opportunity only when one of
 * its eligible shortlisted projects was explicitly invited by the donor/admin,
 * and it only ever receives the sanitized OpportunityBrief — never the
 * requirement row, document, raw text, donor identity or matching internals.
 */

const VISIBLE_STATUSES = ["SHORTLISTED", "NGO_RESPONSE", "SELECTED", "CONTRACTED"] as const;
const OPEN_STATUSES = ["SHORTLISTED", "NGO_RESPONSE"];

export interface NgoOpportunity {
  brief: OpportunityBrief;
  open: boolean;
  invitedProjects: Array<{ id: string; title: string }>;
  response: {
    id: string;
    status: string;
    projectId: string;
    proposedBudget: number | null;
    proposedDurationMonths: number | null;
    implementationPlan: string | null;
    expectedOutcomes: string | null;
    complianceNotes: string | null;
    milestones: unknown;
    submittedAt: string;
  } | null;
}

async function requireNgo(actor: Actor) {
  if (actor.role !== "NGO") throw ERRORS.forbidden();
  const membership = await resolveNgoMembership(actor.id);
  if (!membership) throw new RequirementWorkflowError("Your account is not linked to an NGO.", 403);
  return membership;
}

function serializeResponse(r: any): NgoOpportunity["response"] {
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    projectId: r.projectId,
    proposedBudget: r.proposedBudget === null ? null : Number(r.proposedBudget),
    proposedDurationMonths: r.proposedDurationMonths,
    implementationPlan: r.implementationPlan,
    expectedOutcomes: r.expectedOutcomes,
    complianceNotes: r.complianceNotes,
    milestones: r.milestones,
    submittedAt: r.submittedAt.toISOString(),
  };
}

/** Invited matches for this NGO on requirements still visible, grouped by requirement. */
async function invitedMatches(ngoId: string, requirementId?: string) {
  return prisma.requirementMatch.findMany({
    where: {
      ngoId,
      eligible: true,
      invitedAt: { not: null },
      ...(requirementId ? { requirementId } : {}),
      requirement: { status: { in: [...VISIBLE_STATUSES] } },
    },
    orderBy: { invitedAt: "desc" },
    select: {
      requirementId: true,
      invitedAt: true,
      project: { select: { id: true, title: true } },
      requirement: { select: { id: true, status: true, extractedFields: true, selectedNgoId: true } },
    },
  });
}

function toOpportunity(rows: Awaited<ReturnType<typeof invitedMatches>>, response: any): NgoOpportunity {
  const req = rows[0].requirement;
  const firstInvite = rows.reduce((d, r) => (r.invitedAt! < d ? r.invitedAt! : d), rows[0].invitedAt!);
  return {
    brief: buildOpportunityBrief(req.id, normalizeFields(req.extractedFields), firstInvite),
    open: OPEN_STATUSES.includes(req.status),
    invitedProjects: rows.map((r) => ({ id: r.project.id, title: r.project.title })),
    // The NGO sees only its own response (whose status says SELECTED / REJECTED
    // once decided) — never other NGOs' responses or who was selected.
    response: serializeResponse(response ?? null),
  };
}

export async function listOpportunitiesForNgo(actor: Actor): Promise<NgoOpportunity[]> {
  const { ngoId } = await requireNgo(actor);
  const rows = await invitedMatches(ngoId);
  const byRequirement = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byRequirement.get(row.requirementId) ?? [];
    list.push(row);
    byRequirement.set(row.requirementId, list);
  }
  const responses = await prisma.opportunityResponse.findMany({
    where: { ngoId, requirementId: { in: Array.from(byRequirement.keys()) } },
  });
  return Array.from(byRequirement.values()).map((group) =>
    toOpportunity(group, responses.find((r) => r.requirementId === group[0].requirementId))
  );
}

export async function getOpportunityForNgo(requirementId: string, actor: Actor): Promise<NgoOpportunity> {
  const { ngoId } = await requireNgo(actor);
  const rows = await invitedMatches(ngoId, requirementId);
  if (rows.length === 0) throw new RequirementWorkflowError("This opportunity is not available to your organisation.", 403);
  const response = await prisma.opportunityResponse.findUnique({
    where: { requirementId_ngoId: { requirementId, ngoId } },
  });
  return toOpportunity(rows, response);
}

const optionalNumber = (v: unknown, label: string, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new RequirementWorkflowError(`${label} is not valid.`, 400);
  }
  return n;
};

const optionalText = (v: unknown, label: string, max = 10000) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new RequirementWorkflowError(`${label} must be text.`, 400);
  const t = v.trim();
  if (t.length > max) throw new RequirementWorkflowError(`${label} is too long.`, 400);
  return t || null;
};

function parseMilestones(v: unknown) {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length > 20) throw new RequirementWorkflowError("Provide up to 20 milestones.", 400);
  return v.map((m: any, i: number) => {
    const title = optionalText(m?.title, `Milestone ${i + 1} title`, 200);
    if (!title) throw new RequirementWorkflowError(`Milestone ${i + 1} needs a title.`, 400);
    return {
      title,
      amount: optionalNumber(m?.amount, `Milestone ${i + 1} amount`),
      durationMonths: optionalNumber(m?.durationMonths, `Milestone ${i + 1} duration`, { min: 1, max: 120, integer: true }),
    };
  });
}

/** NGO expresses interest / submits a proposal for an opportunity it was invited to. */
export async function submitInterest(requirementId: string, actor: Actor, body: Record<string, any>) {
  const membership = await requireNgo(actor);
  if (!membership.canRespond) {
    throw new RequirementWorkflowError("Field staff cannot submit proposals. Ask an NGO owner or admin.", 403);
  }
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: membership.ngoId },
    select: { orgName: true, verificationStatus: true, isSuspended: true },
  });
  if (!ngo || ngo.verificationStatus !== "VERIFIED" || ngo.isSuspended) {
    throw new RequirementWorkflowError("Only verified, active NGOs can respond to opportunities.", 403);
  }

  const rows = await invitedMatches(membership.ngoId, requirementId);
  if (rows.length === 0) throw new RequirementWorkflowError("This opportunity is not available to your organisation.", 403);
  const requirement = await prisma.sponsorRequirement.findUnique({ where: { id: requirementId } });
  if (!requirement || !OPEN_STATUSES.includes(requirement.status)) {
    throw new RequirementWorkflowError("This opportunity is no longer accepting responses.", 400);
  }

  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : rows[0].project.id;
  if (!rows.some((r) => r.project.id === projectId)) {
    throw new RequirementWorkflowError("Respond with one of your invited projects.", 400);
  }

  const proposedBudget = optionalNumber(body.proposedBudget, "Proposed budget", { min: 1 });
  const implementationPlan = optionalText(body.implementationPlan, "Implementation plan");
  const payload = {
    projectId,
    proposedBudget,
    proposedDurationMonths: optionalNumber(body.proposedDurationMonths, "Proposed duration", { min: 1, max: 120, integer: true }),
    implementationPlan,
    expectedOutcomes: optionalText(body.expectedOutcomes, "Expected outcomes"),
    complianceNotes: optionalText(body.complianceNotes, "Compliance notes", 4000),
    milestones: parseMilestones(body.milestones) as any,
    status: (proposedBudget && implementationPlan ? "PROPOSAL_SUBMITTED" : "INTERESTED") as "PROPOSAL_SUBMITTED" | "INTERESTED",
    respondedById: actor.id,
  };

  const existing = await prisma.opportunityResponse.findUnique({
    where: { requirementId_ngoId: { requirementId, ngoId: membership.ngoId } },
  });
  if (existing && !["INTERESTED", "PROPOSAL_SUBMITTED"].includes(existing.status)) {
    throw new RequirementWorkflowError("Your response is already under review and can no longer be changed.", 400);
  }

  return prisma.$transaction(async (tx) => {
    const response = existing
      ? await tx.opportunityResponse.update({ where: { id: existing.id }, data: payload })
      : await tx.opportunityResponse.create({ data: { ...payload, requirementId, ngoId: membership.ngoId } });

    const audit = {
      action: "NGO_INTEREST_SUBMITTED" as const,
      detail: `${ngo.orgName} ${existing ? "updated its" : "submitted a"} ${payload.status === "PROPOSAL_SUBMITTED" ? "proposal" : "expression of interest"}.`,
      metadata: { responseId: response.id, projectId, ngoId: membership.ngoId },
    };
    if (requirement.status === "SHORTLISTED") {
      await commitRequirementChange(tx, requirement, {
        actorId: actor.id,
        actorRole: "NGO",
        toStatus: "NGO_RESPONSE",
        audit,
      });
    } else {
      await recordRequirementEvent(tx, {
        requirementId,
        actorId: actor.id,
        actorRole: "NGO",
        fromStatus: requirement.status,
        toStatus: requirement.status,
        ...audit,
      });
    }
    return serializeResponse(response)!;
  });
}
