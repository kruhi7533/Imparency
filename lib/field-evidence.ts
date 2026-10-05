import { ConsentMethod, FieldEvidenceStatus, TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Week 7: field tasks, mobile evidence capture, beneficiary feedback/consent.
 *
 * Everything except `resolveNgoActor` is pure so the rules are testable
 * without a database. The one rule that matters most downstream is
 * `isShareableWithDonor`: a donor sees a photo only when a human approved it
 * AND, if it shows people, the beneficiary consented to sharing it.
 */

// ─── Who is asking ───────────────────────────────────────────────────────────

export interface NgoActor {
  ngoId: string;
  teamRole: TeamRole;
}

/** The caller's NGO and role on it. The NGO owner is reported as OWNER. */
export async function resolveNgoActor(userId: string): Promise<NgoActor | null> {
  const owned = await prisma.nGOProfile.findUnique({ where: { userId }, select: { id: true } });
  if (owned) return { ngoId: owned.id, teamRole: TeamRole.OWNER };
  const membership = await prisma.nGOTeamMember.findFirst({ where: { userId }, select: { ngoId: true, role: true } });
  return membership ? { ngoId: membership.ngoId, teamRole: membership.role } : null;
}

/** Assigning work and seeing everyone's tasks: owners and admins. */
export const CAN_ASSIGN: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN];

export function canManageTasks(actor: NgoActor): boolean {
  return CAN_ASSIGN.includes(actor.teamRole);
}

// ─── Task input ──────────────────────────────────────────────────────────────

export type Check<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseTaskInput(body: any): Check<{
  projectId: string;
  milestoneId: string | null;
  title: string;
  instructions: string | null;
  assignedToId: string;
  dueDate: Date | null;
}> {
  const title = str(body?.title, 200);
  const projectId = str(body?.projectId, 100);
  const assignedToId = str(body?.assignedToId, 100);
  if (!projectId) return { ok: false, status: 400, error: "projectId is required." };
  if (title.length < 3) return { ok: false, status: 400, error: "Give the task a title (at least 3 characters)." };
  if (!assignedToId) return { ok: false, status: 400, error: "Choose who the task is assigned to." };
  let dueDate: Date | null = null;
  if (body?.dueDate) {
    dueDate = new Date(body.dueDate);
    if (Number.isNaN(dueDate.getTime())) return { ok: false, status: 400, error: "dueDate is not a valid date." };
  }
  return {
    ok: true,
    value: {
      projectId,
      milestoneId: str(body?.milestoneId, 100) || null,
      title,
      instructions: str(body?.instructions, 2000) || null,
      assignedToId,
      dueDate,
    },
  };
}

// ─── Capture (one offline-queued submission) ─────────────────────────────────

/** How long a capture may sit in an offline queue before sync is refused. */
export const MAX_OFFLINE_DAYS = 30;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export interface ParsedCapture {
  clientId: string;
  taskId: string;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  capturedAt: Date;
  note: string | null;
  containsPeople: boolean;
  feedback: null | {
    clientId: string;
    beneficiaryRef: string | null;
    consentToRecord: boolean;
    consentToSharePhoto: boolean;
    consentMethod: ConsentMethod;
    rating: number | null;
    feedbackText: string | null;
  };
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const bool = (v: unknown) => v === true || v === "true" || v === "1" || v === "on";

/**
 * Validates the text fields of a capture. `fields` is a plain record built
 * from the multipart form, so the same parser serves the route and the tests.
 */
export function parseCapture(fields: Record<string, unknown>, now: Date = new Date()): Check<ParsedCapture> {
  const clientId = str(fields.clientId, 100);
  if (clientId.length < 8) return { ok: false, status: 400, error: "clientId is required (generated on the device)." };
  const taskId = str(fields.taskId, 100);
  if (!taskId) return { ok: false, status: 400, error: "taskId is required." };

  const latitude = num(fields.latitude);
  const longitude = num(fields.longitude);
  const accuracyM = num(fields.accuracyM);
  if ((latitude === null) !== (longitude === null)) {
    return { ok: false, status: 400, error: "Send both latitude and longitude, or neither." };
  }
  if (Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(accuracyM)) {
    return { ok: false, status: 400, error: "GPS values must be numbers." };
  }
  if (latitude !== null && (latitude < -90 || latitude > 90 || longitude! < -180 || longitude! > 180)) {
    return { ok: false, status: 400, error: "GPS coordinates are out of range." };
  }

  const capturedAt = new Date(str(fields.capturedAt, 40));
  if (Number.isNaN(capturedAt.getTime())) return { ok: false, status: 400, error: "capturedAt is required." };
  if (capturedAt.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, status: 400, error: "capturedAt is in the future — check the device clock." };
  }
  if (now.getTime() - capturedAt.getTime() > MAX_OFFLINE_DAYS * 86_400_000) {
    return { ok: false, status: 422, error: `Captures older than ${MAX_OFFLINE_DAYS} days cannot be synced.` };
  }

  let feedback: ParsedCapture["feedback"] = null;
  if (bool(fields.hasFeedback)) {
    const method = str(fields.consentMethod, 20);
    if (!(Object.values(ConsentMethod) as string[]).includes(method)) {
      return { ok: false, status: 400, error: "consentMethod must be VERBAL, WRITTEN or THUMBPRINT." };
    }
    const consentToRecord = bool(fields.consentToRecord);
    const rating = num(fields.rating);
    if (rating !== null && (Number.isNaN(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return { ok: false, status: 400, error: "rating must be a whole number from 1 to 5." };
    }
    feedback = {
      clientId: `${clientId}:feedback`,
      beneficiaryRef: str(fields.beneficiaryRef, 40) || null,
      consentToRecord,
      // Sharing a photo presupposes agreeing to be recorded at all.
      consentToSharePhoto: consentToRecord && bool(fields.consentToSharePhoto),
      consentMethod: method as ConsentMethod,
      // Without consent to record, the feedback itself is not kept — only the
      // fact that consent was asked and refused.
      rating: consentToRecord ? rating : null,
      feedbackText: consentToRecord ? str(fields.feedbackText, 2000) || null : null,
    };
  }

  return {
    ok: true,
    value: {
      clientId,
      taskId,
      latitude,
      longitude,
      accuracyM,
      capturedAt,
      note: str(fields.note, 2000) || null,
      containsPeople: fields.containsPeople === undefined ? true : bool(fields.containsPeople),
      feedback,
    },
  };
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Sniff the photo type from its bytes, never from the client's claim. */
export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ext: ".png" };
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", ext: ".webp" };
  }
  return null;
}

// ─── Review ──────────────────────────────────────────────────────────────────

export type ReviewDecision = "APPROVE" | "REQUEST_RESUBMIT" | "REJECT";

export const REVIEW_TARGET: Record<ReviewDecision, FieldEvidenceStatus> = {
  APPROVE: FieldEvidenceStatus.APPROVED,
  REQUEST_RESUBMIT: FieldEvidenceStatus.RESUBMIT_REQUESTED,
  REJECT: FieldEvidenceStatus.REJECTED,
};

export function isReviewDecision(v: unknown): v is ReviewDecision {
  return v === "APPROVE" || v === "REQUEST_RESUBMIT" || v === "REJECT";
}

/** Only PENDING_REVIEW is decided. Repeats are no-ops; reversals are 409. */
export function checkReview(
  current: FieldEvidenceStatus,
  decision: ReviewDecision,
  note: unknown,
): { ok: true; noop: boolean; target: FieldEvidenceStatus } | { ok: false; status: number; error: string } {
  const target = REVIEW_TARGET[decision];
  if (current === target) return { ok: true, noop: true, target };
  if (current !== FieldEvidenceStatus.PENDING_REVIEW) {
    return { ok: false, status: 409, error: `This evidence has already been reviewed (${current}).` };
  }
  if (decision !== "APPROVE" && (typeof note !== "string" || note.trim().length < 5)) {
    return { ok: false, status: 400, error: "Tell the field worker why (at least 5 characters)." };
  }
  return { ok: true, noop: false, target };
}

// ─── What a donor may see ────────────────────────────────────────────────────

/**
 * The single rule for donor-visible evidence. Approved by a reviewer, and —
 * if the photo shows people — the beneficiary consented to sharing it and has
 * not withdrawn. Anything else stays inside the NGO.
 */
export function isShareableWithDonor(
  evidence: { status: FieldEvidenceStatus; containsPeople: boolean },
  feedback: { consentToSharePhoto: boolean; withdrawnAt: Date | null } | null,
): boolean {
  if (evidence.status !== FieldEvidenceStatus.APPROVED) return false;
  if (!evidence.containsPeople) return true;
  return !!feedback && feedback.consentToSharePhoto && feedback.withdrawnAt === null;
}

/** Prisma `where` for the same rule, so list queries cannot drift from it. */
export const DONOR_VISIBLE_EVIDENCE_WHERE = {
  status: FieldEvidenceStatus.APPROVED,
  OR: [{ containsPeople: false }, { feedback: { is: { consentToSharePhoto: true, withdrawnAt: null } } }],
};
