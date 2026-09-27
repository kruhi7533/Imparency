import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-log";
import { readPrivateFile } from "@/lib/storage";
import { commitRequirementChange } from "./commit";
import { recordRequirementEvent } from "./audit";
import { ERRORS, RequirementWorkflowError } from "./errors";
import { ADMIN_EDITABLE, DONOR_EDITABLE, assertTransition } from "./status";
import {
  applyEdits,
  normalizeFields,
  verifyAll,
  withDonorProvenance,
  confidenceMap,
  FORM_ENTRY_AGENT,
  REQUIREMENT_FIELDS,
  type RequirementFieldKey,
} from "./provenance";
import { assertAdmin, loadRequirementForActor, workflowRole, type Actor } from "./access";
import { runExtraction } from "./extraction";

/**
 * CSR requirement workflow actions. Every action: load → authorize (owner or
 * admin, derived from the session) → validate the transition → commit the
 * change + audit atomically. Admin decisions are mirrored to AdminActionLog.
 */

function describeFields(keys: RequirementFieldKey[]): string {
  return keys.map((k) => REQUIREMENT_FIELDS[k].label.toLowerCase()).join(", ");
}

function requireText(value: unknown, label: string, min = 5): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min) throw new RequirementWorkflowError(`${label} is required (at least ${min} characters).`, 400);
  if (text.length > 2000) throw new RequirementWorkflowError(`${label} is too long.`, 400);
  return text;
}

/** Fields a form-entered requirement must have — matching and admin validation need them. */
const FORM_REQUIRED: RequirementFieldKey[] = ["summary", "sector", "state"];

/**
 * Donor creates a requirement by filling the structured form instead of
 * uploading a document. There is nothing to extract, so it starts in
 * DONOR_REVIEW (the donor has already "reviewed" what they typed) and follows
 * the normal path from there: submit → admin validation → matching.
 * No document is stored; `fileName` holds the title the donor gave it.
 */
export async function createRequirementFromForm(actor: Actor, body: unknown) {
  if (actor.role !== "DONOR") throw new RequirementWorkflowError("Only donor accounts can create CSR requirements.", 403);
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 3) throw new RequirementWorkflowError("Give the requirement a title (at least 3 characters).", 400);
  if (title.length > 200) throw new RequirementWorkflowError("The title is too long (200 characters max).", 400);

  const rawFields = input.fields;
  if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) {
    throw new RequirementWorkflowError("Provide the requirement details.", 400);
  }
  const fields = withDonorProvenance(rawFields as Record<string, unknown>);

  const missing = FORM_REQUIRED.filter((k) => fields[k].value === null);
  if (missing.length > 0) {
    throw new RequirementWorkflowError(`Please fill in: ${missing.map((k) => REQUIREMENT_FIELDS[k].label).join(", ")}.`, 400);
  }
  const { budgetMin, budgetMax } = fields;
  if (typeof budgetMin.value === "number" && typeof budgetMax.value === "number" && budgetMin.value > budgetMax.value) {
    throw new RequirementWorkflowError("Minimum budget cannot be greater than the maximum budget.", 400);
  }
  const email = fields.contactEmail.value;
  if (typeof email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequirementWorkflowError("Contact email is not a valid email address.", 400);
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.sponsorRequirement.create({
      data: {
        sponsorId: actor.id,
        fileName: title,
        status: "DONOR_REVIEW",
        extractedFields: fields as any,
        confidenceScores: confidenceMap(fields),
        extractedByAgent: FORM_ENTRY_AGENT,
        modelVersion: "manual-entry",
        versionNote: "Entered by donor via form",
        versionAuthorId: actor.id,
        versionAuthorRole: "DONOR",
      },
    });
    await recordRequirementEvent(tx, {
      requirementId: created.id,
      action: "REQUIREMENT_CREATED_FROM_FORM",
      actorId: actor.id,
      actorRole: "DONOR",
      toStatus: "DONOR_REVIEW",
      detail: `"${title}" entered via the requirement form (no document).`,
    });
    return created;
  });
}

/** Donor corrections (AI_EXTRACTED / DONOR_REVIEW / NEEDS_CORRECTION) or admin edits (PENDING_ADMIN_REVIEW). */
export async function editRequirementFields(id: string, actor: Actor, edits: unknown, request?: Request) {
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor);

  if (!edits || typeof edits !== "object" || Array.isArray(edits)) {
    throw new RequirementWorkflowError("Provide the fields to update.", 400);
  }
  const editable = role === "ADMIN" ? ADMIN_EDITABLE : DONOR_EDITABLE;
  if (!editable.includes(req.status)) {
    throw new RequirementWorkflowError(
      role === "ADMIN"
        ? "Admins can edit a requirement only while it is pending admin review."
        : "This requirement can no longer be edited by the donor.",
      400
    );
  }

  const current = normalizeFields(req.extractedFields);
  const { fields, changedKeys } = applyEdits(current, edits as Record<string, unknown>, role);
  const startsReview = role === "DONOR" && req.status === "AI_EXTRACTED";

  if (changedKeys.length === 0 && !startsReview) return req;

  const note =
    changedKeys.length > 0
      ? `${role === "DONOR" ? "Donor" : "Admin"} corrected ${describeFields(changedKeys)}`
      : undefined;

  const updated = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: role,
      toStatus: startsReview ? "DONOR_REVIEW" : undefined,
      fields: changedKeys.length > 0 ? fields : undefined,
      versionNote: note,
      audit: {
        action:
          changedKeys.length === 0
            ? "REQUIREMENT_REVIEW_STARTED"
            : role === "DONOR"
            ? "REQUIREMENT_EDITED_BY_DONOR"
            : "REQUIREMENT_EDITED_BY_ADMIN",
        detail: note ?? "Donor started reviewing the extraction.",
        metadata: changedKeys.length
          ? { changedFields: changedKeys.map((k) => ({ field: k, from: current[k].value, to: fields[k].value })) }
          : undefined,
      },
    })
  );

  if (role === "ADMIN" && changedKeys.length > 0) {
    await logAdminAction({
      adminId: actor.id,
      action: "REQUIREMENT_EDITED",
      entityType: "REQUIREMENT",
      entityId: id,
      oldValue: Object.fromEntries(changedKeys.map((k) => [k, current[k].value])),
      newValue: Object.fromEntries(changedKeys.map((k) => [k, fields[k].value])),
      request,
    });
  }
  return updated;
}

/** Owner submits the reviewed extraction to the admin queue. */
export async function submitForAdminReview(id: string, actor: Actor) {
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor);
  if (role !== "DONOR") throw new RequirementWorkflowError("Only the requirement's owner can submit it for review.", 403);

  return prisma.$transaction(async (tx) => {
    let current = req;
    if (current.status === "AI_EXTRACTED") {
      current = await commitRequirementChange(tx, current, {
        actorId: actor.id,
        actorRole: "DONOR",
        toStatus: "DONOR_REVIEW",
        audit: { action: "REQUIREMENT_REVIEW_STARTED", detail: "Donor reviewed the extraction." },
      });
    }
    return commitRequirementChange(tx, current, {
      actorId: actor.id,
      actorRole: "DONOR",
      toStatus: "PENDING_ADMIN_REVIEW",
      data: { submittedAt: new Date() },
      audit: { action: "REQUIREMENT_SUBMITTED_FOR_ADMIN_REVIEW", detail: "Submitted for admin verification." },
    });
  });
}

/** Admin approval — the governance gate. Only VALIDATED requirements may be matched. */
export async function approveRequirement(id: string, actor: Actor, note: unknown, request?: Request) {
  assertAdmin(actor);
  const req = await loadRequirementForActor(id, actor);
  const current = normalizeFields(req.extractedFields);
  if (!current.sector.value) {
    throw new RequirementWorkflowError("Add the CSR sector before validating — matching needs it.", 400);
  }
  const reviewNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 2000) : null;
  const now = new Date();

  const updated = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: "ADMIN",
      toStatus: "VALIDATED",
      fields: verifyAll(current),
      versionNote: "Admin verified requirement",
      data: { reviewedById: actor.id, reviewedAt: now, validatedAt: now, reviewNote },
      audit: { action: "REQUIREMENT_VALIDATED", detail: reviewNote ?? "Requirement validated by admin." },
    })
  );

  await logAdminAction({
    adminId: actor.id,
    action: "REQUIREMENT_VALIDATED",
    entityType: "REQUIREMENT",
    entityId: id,
    oldValue: { status: req.status },
    newValue: { status: "VALIDATED" },
    note: reviewNote,
    request,
  });
  return updated;
}

export async function rejectRequirement(id: string, actor: Actor, reason: unknown, request?: Request) {
  assertAdmin(actor);
  const text = requireText(reason, "A rejection reason");
  const req = await loadRequirementForActor(id, actor);

  const updated = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: "ADMIN",
      toStatus: "REJECTED",
      data: { reviewedById: actor.id, reviewedAt: new Date(), reviewNote: text },
      audit: { action: "REQUIREMENT_REJECTED", detail: text },
    })
  );
  await logAdminAction({
    adminId: actor.id,
    action: "REQUIREMENT_REJECTED",
    entityType: "REQUIREMENT",
    entityId: id,
    oldValue: { status: req.status },
    newValue: { status: "REJECTED" },
    note: text,
    request,
  });
  return updated;
}

export async function requestCorrection(id: string, actor: Actor, note: unknown, request?: Request) {
  assertAdmin(actor);
  const text = requireText(note, "A note explaining what to correct");
  const req = await loadRequirementForActor(id, actor);

  const updated = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: "ADMIN",
      toStatus: "NEEDS_CORRECTION",
      data: { reviewedById: actor.id, reviewedAt: new Date(), reviewNote: text },
      audit: { action: "REQUIREMENT_CORRECTION_REQUESTED", detail: text },
    })
  );
  await logAdminAction({
    adminId: actor.id,
    action: "REQUIREMENT_CORRECTION_REQUESTED",
    entityType: "REQUIREMENT",
    entityId: id,
    oldValue: { status: req.status },
    newValue: { status: "NEEDS_CORRECTION" },
    note: text,
    request,
  });
  return updated;
}

/**
 * Re-runs the Requirements Analyst Agent on the stored original. The owner may
 * retry a FAILED extraction; admins may also re-run at any review stage (the
 * state machine enforces which).
 */
export async function rerunExtraction(id: string, actor: Actor, request?: Request) {
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor);
  if (!req.storageKey) {
    throw new RequirementWorkflowError("The original document is not available for re-processing.", 400);
  }
  // Validate before reading the file so an illegal re-run fails fast.
  assertTransition(req.status, "PROCESSING", role);

  const buffer = await readPrivateFile(req.storageKey);
  const updated = await runExtraction({ requirement: req, buffer, startedBy: { id: actor.id, role }, isRerun: true });

  if (role === "ADMIN") {
    await logAdminAction({
      adminId: actor.id,
      action: "REQUIREMENT_EXTRACTION_RERUN",
      entityType: "REQUIREMENT",
      entityId: id,
      oldValue: { status: req.status, version: req.version },
      newValue: { status: updated.status, version: updated.version },
      request,
    });
  }
  return updated;
}

/** Shares the sanitized brief with one eligible shortlisted candidate's NGO. */
export async function inviteMatch(id: string, actor: Actor, matchId: string) {
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor);
  if (req.status !== "SHORTLISTED" && req.status !== "NGO_RESPONSE") {
    throw new RequirementWorkflowError("NGOs can be invited only after matching has produced a shortlist.", 400);
  }

  const latest = await prisma.gapReport.findFirst({
    where: { sponsorRequirementId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, reviewStatus: true },
  });
  const match = await prisma.requirementMatch.findUnique({
    where: { id: matchId },
    include: { ngo: { select: { orgName: true, verificationStatus: true, isSuspended: true } } },
  });
  if (!match || match.requirementId !== id || match.gapReportId !== latest?.id) {
    throw new RequirementWorkflowError("Match not found in the current shortlist.", 404);
  }
  if (latest.reviewStatus === "REJECTED") {
    throw new RequirementWorkflowError("An admin rejected this analysis. Re-run matching before inviting NGOs.", 400);
  }
  if (!match.eligible) throw new RequirementWorkflowError("This candidate is not eligible for the requirement.", 400);
  if (match.ngo.verificationStatus !== "VERIFIED" || match.ngo.isSuspended) {
    throw new RequirementWorkflowError("This NGO is no longer verified and cannot be invited.", 400);
  }
  if (match.invitedAt) return match;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.requirementMatch.update({
      where: { id: matchId },
      data: { invitedAt: new Date(), invitedById: actor.id },
    });
    await recordRequirementEvent(tx, {
      requirementId: id,
      action: "OPPORTUNITY_SHARED",
      actorId: actor.id,
      actorRole: role,
      fromStatus: req.status,
      toStatus: req.status,
      detail: `Opportunity brief shared with ${match.ngo.orgName}.`,
      metadata: { matchId, projectId: match.projectId, ngoId: match.ngoId },
    });
    return updated;
  });
}

/** Donor/admin awards the requirement to one NGO response (single award). */
export async function selectResponse(id: string, actor: Actor, responseId: unknown) {
  if (typeof responseId !== "string" || !responseId) {
    throw new RequirementWorkflowError("Choose the NGO response to select.", 400);
  }
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor);

  const response = await prisma.opportunityResponse.findUnique({
    where: { id: responseId },
    include: { ngo: { select: { orgName: true, verificationStatus: true, isSuspended: true } } },
  });
  if (!response || response.requirementId !== id) {
    throw new RequirementWorkflowError("Response not found for this requirement.", 404);
  }
  if (response.status === "REJECTED") throw new RequirementWorkflowError("This response was already declined.", 400);
  if (response.ngo.verificationStatus !== "VERIFIED" || response.ngo.isSuspended) {
    throw new RequirementWorkflowError("This NGO is no longer verified and cannot be selected.", 400);
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: role,
      toStatus: "SELECTED",
      data: { selectedProjectId: response.projectId, selectedNgoId: response.ngoId, selectedAt: now },
      audit: {
        action: "NGO_SELECTED",
        detail: `${response.ngo.orgName} selected.`,
        metadata: { responseId, projectId: response.projectId, ngoId: response.ngoId },
      },
    });
    await tx.opportunityResponse.update({
      where: { id: responseId },
      data: { status: "SELECTED", reviewedAt: now, reviewedById: actor.id },
    });
    await tx.opportunityResponse.updateMany({
      where: { requirementId: id, id: { not: responseId }, status: { not: "REJECTED" } },
      data: { status: "REJECTED", reviewedAt: now, reviewedById: actor.id },
    });
    return updated;
  });
}

export { ERRORS };
