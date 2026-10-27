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
  REQUIREMENT_FIELD_KEYS,
  type RequirementFieldKey,
} from "./provenance";
import { assertAdmin, donorAccountFor, loadRequirementForActor, requireVerifiedFunder, workflowRole, type Actor } from "./access";
import { SECTOR_OPTIONS, INDIAN_STATES, namesKnownOption } from "./form-options";
import { runExtraction } from "./extraction";
import { readFlags, unconfirmedBlockingFlags, FLAG_LABELS } from "./extraction-checks";
import { Prisma } from "@prisma/client";
import { assertResponseTransition } from "./response-status";
import { MANUAL_ENTRY_MODEL } from "./dto";

/** Refuses to move a requirement on while a blocking extraction flag is unconfirmed (AI-002 / NEG-004). */
function assertFlagsConfirmed(req: { extractionFlags?: unknown }) {
  const open = unconfirmedBlockingFlags(req.extractionFlags);
  if (open.length > 0) {
    throw new RequirementWorkflowError(
      `Confirm the extraction warning${open.length > 1 ? "s" : ""} first: ${open.map((f) => FLAG_LABELS[f.code]).join(", ")}.`,
      409,
      "FLAGS_UNCONFIRMED"
    );
  }
}

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

/**
 * Matching compares sector and state against the lists in form-options.ts. A
 * value those lists cannot read scores zero against every candidate, so the run
 * comes back empty and reads as "no NGO fits this" rather than "the extractor
 * put nonsense in this field". Refuse it at the validation gate instead, which
 * is the last point where a human is looking and can still correct it.
 */
function assertKnownOption(value: unknown, options: string[], label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!namesKnownOption(text, options)) {
    throw new RequirementWorkflowError(
      `The ${label} reads "${text.slice(0, 80)}", which names nothing matching can use. Correct it before validating.`,
      400
    );
  }
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
  // A team member creates it for their organisation's account (lib/donor-team.ts).
  const sponsorId = donorAccountFor(actor, "editRequirements");
  await requireVerifiedFunder(sponsorId);
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
        sponsorId,
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
  const role = workflowRole(req, actor, "editRequirements");

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
  const role = workflowRole(req, actor, "editRequirements");
  if (role !== "DONOR") throw new RequirementWorkflowError("Only the requirement's owner can submit it for review.", 403);
  assertFlagsConfirmed(req);

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
  assertFlagsConfirmed(req);
  const current = normalizeFields(req.extractedFields);
  if (!current.sector.value) {
    throw new RequirementWorkflowError("Add the CSR sector before validating — matching needs it.", 400);
  }
  assertKnownOption(current.sector.value, SECTOR_OPTIONS, "CSR sector");
  // State is not required to exist (document extractions often miss it), but a
  // state that *is* set has to be one matching can read.
  if (current.state.value) assertKnownOption(current.state.value, INDIAN_STATES, "target state");
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
  const role = workflowRole(req, actor, "editRequirements");
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

/**
 * The owner gives up on extraction and types the details in themselves
 * (FAILED → DONOR_REVIEW). The stored document stays attached for reference;
 * nothing is extracted or invented — every field starts empty as a donor entry.
 */
export async function startManualEntry(id: string, actor: Actor) {
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor, "editRequirements");
  if (role !== "DONOR") throw new RequirementWorkflowError("Only the requirement's owner can enter its details manually.", 403);
  if (req.status !== "FAILED") {
    throw new RequirementWorkflowError("Manual entry is only offered when document extraction has failed.", 400);
  }
  const existing = normalizeFields(req.extractedFields);
  const hasValues = REQUIREMENT_FIELD_KEYS.some((k) => existing[k].value !== null);
  return prisma.$transaction((tx) =>
    commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: "DONOR",
      toStatus: "DONOR_REVIEW",
      // Keep anything a previous successful extraction left; otherwise start from blank donor entries.
      fields: hasValues ? undefined : withDonorProvenance({}),
      versionNote: hasValues ? undefined : "Details entered manually by donor (extraction failed)",
      data: { extractionError: Prisma.DbNull, ...(hasValues ? {} : { modelVersion: MANUAL_ENTRY_MODEL }) },
      audit: {
        action: "REQUIREMENT_MANUAL_ENTRY_STARTED",
        detail: "Extraction failed; the donor is entering the requirement details manually.",
      },
    })
  );
}

/**
 * Owner (while editable) or admin (at review) confirms a blocking extraction
 * flag — e.g. "the budget is ₹50 lakh, not ₹75 lakh", or "the injected text was
 * ignored". A note is required: it is the human decision the flag asked for.
 * Idempotent: confirming a confirmed flag returns the requirement unchanged.
 */
export async function confirmExtractionFlag(id: string, actor: Actor, flagId: unknown, note: unknown) {
  if (typeof flagId !== "string" || !flagId) throw new RequirementWorkflowError("Choose the warning to confirm.", 400);
  const text = requireText(note, "A note explaining your confirmation");
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor, "editRequirements");
  const editable = role === "ADMIN" ? ADMIN_EDITABLE : DONOR_EDITABLE;
  if (!editable.includes(req.status)) {
    throw new RequirementWorkflowError("Warnings can be confirmed only while the requirement is being reviewed.", 400);
  }
  const flags = readFlags(req.extractionFlags);
  const flag = flags.find((f) => f.id === flagId);
  if (!flag) throw new RequirementWorkflowError("Warning not found on this requirement.", 404);
  if (flag.confirmedAt) return req;

  const now = new Date().toISOString();
  const next = flags.map((f) =>
    f.id === flagId ? { ...f, confirmedAt: now, confirmedById: actor.id, confirmedByRole: role, confirmationNote: text } : f
  );
  const updated = await prisma.$transaction((tx) =>
    commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: role,
      data: { extractionFlags: next as any },
      audit: {
        action: "REQUIREMENT_FLAG_CONFIRMED",
        detail: `${FLAG_LABELS[flag.code]} confirmed: ${text}`,
        metadata: { flagId, code: flag.code },
      },
    })
  );
  if (role === "ADMIN") {
    await logAdminAction({
      adminId: actor.id,
      action: "REQUIREMENT_EDITED",
      entityType: "REQUIREMENT",
      entityId: id,
      oldValue: { flag: flag.code, confirmed: false },
      newValue: { flag: flag.code, confirmed: true },
      note: text,
    });
  }
  return updated;
}

/**
 * ADM-006: the admin decides the shortlist before any NGO is invited —
 * approves candidates in an explicit order, rejects others with a reason.
 * Body: { gapReportId, order: matchId[] (approved, first = 1), rejected?: [{ matchId, reason }], note? }.
 * Only the latest run, only while no NGO has been invited, only eligible
 * candidates. Re-deciding before invitations replaces the previous decision.
 */
export async function reviewShortlist(id: string, actor: Actor, body: unknown, request?: Request) {
  assertAdmin(actor);
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const req = await loadRequirementForActor(id, actor);
  if (req.status !== "SHORTLISTED") {
    throw new RequirementWorkflowError("The shortlist can be reviewed only after matching and before NGOs respond.", 400);
  }
  const latest = await prisma.gapReport.findFirst({
    where: { sponsorRequirementId: id },
    orderBy: { createdAt: "desc" },
    include: { matches: { select: { id: true, eligible: true, invitedAt: true } } },
  });
  if (!latest || input.gapReportId !== latest.id) {
    throw new RequirementWorkflowError("This shortlist is out of date. Reload to review the latest matching run.", 409);
  }
  if (latest.matches.some((m) => m.invitedAt)) {
    throw new RequirementWorkflowError("NGOs have already been invited from this shortlist; it can no longer be reordered.", 409);
  }

  const byId = new Map(latest.matches.map((m) => [m.id, m]));
  const order = Array.isArray(input.order) ? input.order : [];
  const rejectedRaw = Array.isArray(input.rejected) ? input.rejected : [];
  if (order.length === 0) throw new RequirementWorkflowError("Approve at least one candidate (or reject the analysis instead).", 400);
  if (order.some((m) => typeof m !== "string") || new Set(order).size !== order.length) {
    throw new RequirementWorkflowError("The order must list each approved candidate once.", 400);
  }
  for (const matchId of order as string[]) {
    const m = byId.get(matchId);
    if (!m) throw new RequirementWorkflowError("A candidate in the order is not in this shortlist.", 400);
    if (!m.eligible) throw new RequirementWorkflowError("Only eligible candidates can be approved.", 400);
  }
  const rejected = rejectedRaw.map((r: any) => ({
    matchId: typeof r?.matchId === "string" ? r.matchId : "",
    reason: requireText(r?.reason, "A reason for each rejected candidate", 3),
  }));
  for (const r of rejected) {
    if (!byId.has(r.matchId)) throw new RequirementWorkflowError("A rejected candidate is not in this shortlist.", 400);
    if ((order as string[]).includes(r.matchId)) throw new RequirementWorkflowError("A candidate cannot be both approved and rejected.", 400);
  }
  const decided = new Set([...(order as string[]), ...rejected.map((r) => r.matchId)]);
  const undecided = latest.matches.filter((m) => m.eligible && !decided.has(m.id));
  if (undecided.length > 0) {
    throw new RequirementWorkflowError("Approve or reject every eligible candidate.", 400);
  }
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 2000) : null;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Re-checked inside the transaction: an invitation racing this review wins.
    const invited = await tx.requirementMatch.count({ where: { gapReportId: latest.id, invitedAt: { not: null } } });
    if (invited > 0) throw ERRORS.conflict();
    await tx.requirementMatch.updateMany({
      where: { gapReportId: latest.id },
      data: { adminDecision: null, adminRank: null, adminNote: null, adminDecidedAt: null, adminDecidedById: null },
    });
    for (let i = 0; i < order.length; i++) {
      const matchId = order[i] as string;
      await tx.requirementMatch.update({
        where: { id: matchId },
        data: { adminDecision: "APPROVED", adminRank: i + 1, adminDecidedAt: now, adminDecidedById: actor.id },
      });
    }
    for (const r of rejected) {
      await tx.requirementMatch.update({
        where: { id: r.matchId },
        data: { adminDecision: "REJECTED", adminNote: r.reason, adminDecidedAt: now, adminDecidedById: actor.id },
      });
    }
    await tx.gapReport.update({
      where: { id: latest.id },
      data: { reviewStatus: "APPROVED", reviewedBy: actor.id, reviewedAt: now, reviewNote: note },
    });
    await recordRequirementEvent(tx, {
      requirementId: id,
      action: "SHORTLIST_ADMIN_APPROVED",
      actorId: actor.id,
      actorRole: "ADMIN",
      fromStatus: req.status,
      toStatus: req.status,
      detail: `Admin approved ${order.length} candidate(s) in order${rejected.length ? ` and rejected ${rejected.length}` : ""}.${note ? ` ${note}` : ""}`,
      metadata: { gapReportId: latest.id, order, rejected: rejected.map((r) => r.matchId) },
    });
  });

  await logAdminAction({
    adminId: actor.id,
    action: "GAP_REPORT_APPROVED",
    entityType: "GAP_REPORT",
    entityId: latest.id,
    oldValue: { reviewStatus: latest.reviewStatus },
    newValue: { reviewStatus: "APPROVED", order, rejected: rejected.map((r) => r.matchId) },
    note,
    request,
  });
  return { gapReportId: latest.id, order, rejected: rejected.map((r) => r.matchId) };
}

/** Shares the sanitized brief with one eligible shortlisted candidate's NGO. */
export async function inviteMatch(id: string, actor: Actor, matchId: string) {
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor, "decide");
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
    include: {
      ngo: { select: { orgName: true, verificationStatus: true, isSuspended: true, userId: true } },
      project: { select: { title: true } },
    },
  });
  if (!match || match.requirementId !== id || match.gapReportId !== latest?.id) {
    throw new RequirementWorkflowError("Match not found in the current shortlist.", 404);
  }
  if (latest.reviewStatus === "REJECTED") {
    throw new RequirementWorkflowError("An admin rejected this analysis. Re-run matching before inviting NGOs.", 400);
  }
  if (!match.eligible) throw new RequirementWorkflowError("This candidate is not eligible for the requirement.", 400);
  // ADM-006: no NGO is invited before an admin has approved the shortlist.
  if (latest.reviewStatus !== "APPROVED") {
    throw new RequirementWorkflowError("An admin has to approve the shortlist before NGOs can be invited.", 409, "SHORTLIST_NOT_APPROVED");
  }
  if ((match as any).adminDecision !== "APPROVED") {
    throw new RequirementWorkflowError("An admin excluded this candidate from the shortlist.", 400, "CANDIDATE_NOT_APPROVED");
  }
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
    // DON-006: the NGO learns of the invitation in its notification bell, not
    // only if it happens to open the match inbox. Same transaction, so a retry
    // of an already-invited match (returned above) never notifies twice.
    await tx.notification.create({
      data: {
        userId: match.ngo.userId,
        type: "CSR_INVITATION",
        title: "A CSR funder invited you to submit a proposal",
        body: `Your project "${match.project?.title ?? "project"}" was shortlisted for a CSR requirement. Open your match inbox to respond.`,
      },
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
  const role = workflowRole(req, actor, "decide");

  const response = await prisma.opportunityResponse.findUnique({
    where: { id: responseId },
    include: { ngo: { select: { orgName: true, verificationStatus: true, isSuspended: true } } },
  });
  if (!response || response.requirementId !== id) {
    throw new RequirementWorkflowError("Response not found for this requirement.", 404);
  }
  if (response.status === "REJECTED") throw new RequirementWorkflowError("This response was already declined.", 400);
  // Approval is of a submitted proposal — not an expression of interest, and not
  // one that is back with the NGO for changes (WEEK5 SPEC-3/SPEC-6).
  if (response.status === "CHANGES_REQUESTED") {
    throw new RequirementWorkflowError("This proposal is back with the organisation for changes. Wait for the revised version.", 400);
  }
  assertResponseTransition(response.status, "SELECTED", role);
  if (response.ngo.verificationStatus !== "VERIFIED" || response.ngo.isSuspended) {
    throw new RequirementWorkflowError("This NGO is no longer verified and cannot be selected.", 400);
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: role,
      toStatus: "SELECTED",
      // SPEC-6: pin the approved version, so "approved" means what the donor read.
      data: {
        selectedProjectId: response.projectId,
        selectedNgoId: response.ngoId,
        selectedAt: now,
        selectedResponseVersion: response.version,
      },
      audit: {
        action: "NGO_SELECTED",
        detail: `Proposal V${response.version} from ${response.ngo.orgName} approved — ready for contracting.`,
        metadata: { responseId, projectId: response.projectId, ngoId: response.ngoId, version: response.version },
      },
    });
    // Guarded on the version read above: if the NGO resubmitted in the meantime,
    // the donor approved something that no longer exists — refuse, don't guess.
    const { count } = await tx.opportunityResponse.updateMany({
      where: { id: responseId, status: response.status, version: response.version },
      data: { status: "SELECTED", reviewedAt: now, reviewedById: actor.id },
    });
    if (count === 0) throw ERRORS.conflict();
    await tx.opportunityResponse.updateMany({
      where: { requirementId: id, id: { not: responseId }, status: { not: "REJECTED" } },
      data: { status: "REJECTED", reviewedAt: now, reviewedById: actor.id },
    });
    return updated;
  });
}

/**
 * The owning donor withdraws a requirement (allowed stages: lib/requirements/status.ts).
 * Every NGO response still open on it is closed and that NGO is told why — a
 * proposal must never be left waiting on a requirement that no longer exists.
 */
export async function withdrawRequirement(id: string, actor: Actor, reason: unknown) {
  const text = requireText(reason, "A reason for withdrawing", 10);
  const req = await loadRequirementForActor(id, actor);
  const role = workflowRole(req, actor, "editRequirements");
  if (role !== "DONOR") throw new RequirementWorkflowError("Only the requirement's owner can withdraw it.", 403);

  const now = new Date();
  const { updated, closed } = await prisma.$transaction(async (tx) => {
    const updated = await commitRequirementChange(tx, req, {
      actorId: actor.id,
      actorRole: "DONOR",
      toStatus: "WITHDRAWN",
      audit: { action: "REQUIREMENT_WITHDRAWN", detail: text },
    });
    const open = await tx.opportunityResponse.findMany({
      where: { requirementId: id, status: { notIn: ["REJECTED", "SELECTED"] } },
      select: { id: true, ngo: { select: { userId: true } } },
    });
    if (open.length > 0) {
      await tx.opportunityResponse.updateMany({
        where: { id: { in: open.map((o) => o.id) } },
        data: { status: "REJECTED", reviewedAt: now, reviewedById: actor.id },
      });
    }
    return { updated, closed: open };
  });

  if (closed.length > 0) {
    try {
      await prisma.notification.createMany({
        data: closed.map((o) => ({
          userId: o.ngo.userId,
          type: "CSR_REQUIREMENT_WITHDRAWN",
          title: "A CSR opportunity was withdrawn",
          body: "The funder withdrew a CSR requirement you responded to, so your response has been closed. This is not a judgement on your proposal.",
        })),
      });
    } catch (err) {
      console.error("[requirements] withdrawal notification failed:", err);
    }
  }
  return updated;
}

export { ERRORS };
