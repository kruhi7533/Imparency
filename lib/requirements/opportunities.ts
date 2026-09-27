import prisma from "@/lib/prisma";
import { commitRequirementChange } from "./commit";
import { recordRequirementEvent } from "./audit";
import { ERRORS, RequirementWorkflowError } from "./errors";
import { normalizeFields } from "./provenance";
import { buildOpportunityBrief, type OpportunityBrief } from "./sanitize";
import { serializeRevision, type ResponseRevisionItem } from "./dto";
import { loadRequirementForActor, resolveNgoMembership, workflowRole, type Actor } from "./access";
import { openNgoInquiryThread, appendToThread } from "@/lib/inquiry-thread";
import {
  assertResponseTransition,
  CHANGE_NOTE_MAX,
  CHANGE_NOTE_MIN,
  NGO_EDITABLE_RESPONSE,
  PROPOSAL_STATUSES,
} from "./response-status";

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
    version: number;
    revisionRounds: number;
    changeRequestNote: string | null;
    changeRequestedAt: string | null;
    /** Superseded versions, newest first. Only loaded on the detail view. */
    revisions: ResponseRevisionItem[];
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
    version: r.version ?? 1,
    revisionRounds: r.revisionRounds ?? 0,
    changeRequestNote: r.changeRequestNote ?? null,
    changeRequestedAt: r.changeRequestedAt ? new Date(r.changeRequestedAt).toISOString() : null,
    revisions: Array.isArray(r.revisions) ? r.revisions.map(serializeRevision) : [],
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
    include: { revisions: { orderBy: { version: "desc" } } },
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
  if (existing && !NGO_EDITABLE_RESPONSE.includes(existing.status)) {
    throw new RequirementWorkflowError("Your response is already under review and can no longer be changed.", 400);
  }
  // Once a full proposal exists, a resubmission must still be one — a revision
  // cannot quietly downgrade to an expression of interest.
  const hadProposal = !!existing && PROPOSAL_STATUSES.includes(existing.status);
  if (hadProposal && payload.status !== "PROPOSAL_SUBMITTED") {
    throw new RequirementWorkflowError("A revised proposal needs a proposed budget and an implementation plan.", 400);
  }
  if (existing && existing.status !== payload.status) {
    assertResponseTransition(existing.status, payload.status, "NGO");
  }
  const answeringChangeRequest = existing?.status === "CHANGES_REQUESTED";

  const result = await prisma.$transaction(async (tx) => {
    let response;
    if (existing) {
      // SPEC-4: snapshot the outgoing proposal before overwriting it, in the
      // same transaction — if the snapshot fails, the update must not happen.
      if (hadProposal) {
        await tx.opportunityResponseRevision.create({
          data: {
            responseId: existing.id,
            version: existing.version,
            status: existing.status,
            projectId: existing.projectId,
            proposedBudget: existing.proposedBudget,
            proposedDurationMonths: existing.proposedDurationMonths,
            implementationPlan: existing.implementationPlan,
            milestones: (existing.milestones as any) ?? undefined,
            expectedOutcomes: existing.expectedOutcomes,
            complianceNotes: existing.complianceNotes,
            submittedAt: existing.submittedAt,
            supersededBecause: answeringChangeRequest ? existing.changeRequestNote : null,
            changedById: actor.id,
            changedByRole: "NGO",
          },
        });
      }
      // Guarded on the status and version we read: a concurrent change (a donor
      // decision, another team member's edit) becomes a clean 409.
      const { count } = await tx.opportunityResponse.updateMany({
        where: { id: existing.id, status: existing.status, version: existing.version },
        data: {
          ...payload,
          ...(hadProposal ? { version: existing.version + 1, submittedAt: new Date() } : {}),
        },
      });
      if (count === 0) throw ERRORS.conflict();
      response = await tx.opportunityResponse.findUniqueOrThrow({ where: { id: existing.id } });
    } else {
      response = await tx.opportunityResponse.create({ data: { ...payload, requirementId, ngoId: membership.ngoId } });
    }

    const isProposal = payload.status === "PROPOSAL_SUBMITTED";
    const audit = {
      action: (hadProposal ? "NGO_RESPONSE_REVISED" : "NGO_INTEREST_SUBMITTED") as "NGO_RESPONSE_REVISED" | "NGO_INTEREST_SUBMITTED",
      detail: hadProposal
        ? `${ngo.orgName} submitted proposal V${response.version}${answeringChangeRequest ? " in reply to the change request" : ""}.`
        : `${ngo.orgName} ${existing ? "updated its" : "submitted a"} ${isProposal ? "proposal" : "expression of interest"}.`,
      metadata: { responseId: response.id, projectId, ngoId: membership.ngoId, version: response.version },
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

  // Tell the donor a revision is waiting. Best-effort: the response is saved and
  // visible on their requirement page either way.
  if (answeringChangeRequest && requirement.sponsorId) {
    try {
      await prisma.notification.create({
        data: {
          userId: requirement.sponsorId,
          type: "CSR_PROPOSAL_REVISED",
          title: "A revised proposal is ready for your review",
          body: `${ngo.orgName} submitted proposal V${result.version} in reply to your change request.`,
        },
      });
    } catch (err) {
      console.error("[opportunities] failed to notify donor of revision:", err);
    }
  }
  return result;
}

/**
 * Donor (or admin) sends a submitted proposal back with a required note
 * (WEEK5 SPEC-3). The requirement's own status does not move — it stays
 * NGO_RESPONSE; the round trip is between two parties about one response.
 */
export async function requestResponseChanges(requirementId: string, actor: Actor, responseId: unknown, note: unknown) {
  if (typeof responseId !== "string" || !responseId) {
    throw new RequirementWorkflowError("Choose the proposal to send back.", 400);
  }
  const req = await loadRequirementForActor(requirementId, actor);
  const role = workflowRole(req, actor);

  const text = typeof note === "string" ? note.trim() : "";
  if (text.length < CHANGE_NOTE_MIN) {
    throw new RequirementWorkflowError(
      `Tell the organisation what to change (at least ${CHANGE_NOTE_MIN} characters).`,
      400
    );
  }
  if (text.length > CHANGE_NOTE_MAX) throw new RequirementWorkflowError("The change request is too long.", 400);

  if (req.status !== "NGO_RESPONSE") {
    throw new RequirementWorkflowError("Changes can only be requested while proposals are being reviewed.", 400);
  }
  const response = await prisma.opportunityResponse.findUnique({
    where: { id: responseId },
    include: { ngo: { select: { id: true, orgName: true } } },
  });
  if (!response || response.requirementId !== requirementId) {
    throw new RequirementWorkflowError("Proposal not found for this requirement.", 404);
  }
  assertResponseTransition(response.status, "CHANGES_REQUESTED", role);

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // Guarded on the status we read, so a double click (or a race with the NGO
    // resubmitting) cannot count a second round.
    const { count } = await tx.opportunityResponse.updateMany({
      where: { id: response.id, status: response.status, version: response.version },
      data: {
        status: "CHANGES_REQUESTED",
        changeRequestNote: text,
        changeRequestedAt: now,
        changeRequestedById: actor.id,
        revisionRounds: { increment: 1 },
        reviewedAt: now,
        reviewedById: actor.id,
      },
    });
    if (count === 0) throw ERRORS.conflict();
    await recordRequirementEvent(tx, {
      requirementId,
      action: "NGO_RESPONSE_CHANGES_REQUESTED",
      actorId: actor.id,
      actorRole: role,
      fromStatus: req.status,
      toStatus: req.status,
      detail: `Changes requested on ${response.ngo.orgName}'s proposal V${response.version}.`,
      metadata: { responseId: response.id, ngoId: response.ngoId, version: response.version, note: text },
    });
    return tx.opportunityResponse.findUniqueOrThrow({ where: { id: response.id } });
  });

  await notifyNgoOfChangeRequest(requirementId, req.extractedFields, response.ngoId, updated.revisionRounds, text);
  return updated;
}

/**
 * One thread per opportunity per NGO in the NGO's existing inbox
 * (/ngo/inquiries); each change request appends. The platform speaks — the
 * donor's identity is never disclosed to the NGO, matching the sanitized brief.
 * Best-effort: the note is already on the NGO's opportunity page.
 */
async function notifyNgoOfChangeRequest(
  requirementId: string,
  extractedFields: unknown,
  ngoId: string,
  round: number,
  note: string
) {
  try {
    const title = buildOpportunityBrief(requirementId, normalizeFields(extractedFields)).title;
    const subject = `Changes requested: ${title}`;
    const body = [
      `The CSR sponsor reviewed your proposal for "${title}" and asked for changes (revision round ${round}):`,
      "",
      note,
      "",
      "Open the opportunity in your CSR Opportunities list to revise and resubmit. Your earlier version is kept.",
    ].join("\n");
    const shared = {
      adminId: null,
      subject,
      body,
      entityType: "REQUIREMENT",
      entityId: requirementId,
      notificationType: "CSR_CHANGES_REQUESTED",
      notificationTitle: "The sponsor asked for changes to your proposal",
    };
    const existing = await prisma.reviewThread.findFirst({
      where: { subjectType: "NGO", subjectId: ngoId, entityType: "REQUIREMENT", entityId: requirementId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (!existing) {
      await openNgoInquiryThread({ ngoId, ...shared });
      return;
    }
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      select: { orgName: true, user: { select: { id: true, email: true } } },
    });
    if (!ngo) return;
    await appendToThread(existing.id, {
      subjectType: "NGO",
      subjectId: ngoId,
      participantUserId: ngo.user.id,
      recipientEmail: ngo.user.email,
      recipientName: ngo.orgName,
      ...shared,
    });
  } catch (err) {
    console.error("[opportunities] failed to notify NGO of change request:", err);
  }
}
