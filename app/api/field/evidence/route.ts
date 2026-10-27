import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { isUniqueConstraintError } from "@/lib/razorpay-webhook";
import { deletePrivateFile, isStorageError, uploadPrivateFile } from "@/lib/storage";
import { classifyProofLocation } from "@/lib/proof-location";
import { ACCEPTED_PHOTO_TYPES, canManageTasks, MAX_PHOTO_BYTES, parseCapture, resolveNgoActor, sniffImage } from "@/lib/field-evidence";
import { findPriorEvidence } from "@/lib/evidence-duplicates";
import { createFraudAlert } from "@/lib/fraud-alerts";
import {
  buildDuplicateDescription,
  classifyDuplicate,
  duplicateSeverity,
  evidenceSlot,
  type DuplicateResult,
} from "@/lib/proof-fingerprint";

export const runtime = "nodejs";

/**
 * Structured error. `code` tells the field app (and a tester) which stage
 * failed; `retryable` tells the offline queue whether resending can help.
 * Never a raw provider/Prisma message.
 */
function fail(status: number, code: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, code, retryable: status >= 500 || status === 429, ...extra }, { status });
}

/**
 * Sync one capture from the field app: a photo + GPS + note against a task,
 * optionally with beneficiary feedback/consent. Or feedback alone (no photo).
 *
 * Multipart form. Idempotent on the device-generated `clientId`, because an
 * offline queue WILL resend: a capture synced twice is stored once and the
 * second call gets the first result back.
 */
export async function POST(request: Request) {
  const rl = await checkRateLimit(request, "field/evidence", 200, 300);
  if (rl.isBlocked) return rl.response;
  let uploadedKey: string | null = null;
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const userId: string = session.user.id;

    const actor = await resolveNgoActor(userId);
    if (!actor) return fail(403, "NO_NGO_MEMBERSHIP", "No NGO membership");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, "INVALID_FORM", "Expected multipart form data.");
    }
    const fields: Record<string, unknown> = {};
    form.forEach((v, k) => {
      if (typeof v === "string") fields[k] = v;
    });

    const parsed = parseCapture(fields);
    if (!parsed.ok) return fail(parsed.status, "INVALID_CAPTURE", parsed.error);
    const capture = parsed.value;

    const task = await prisma.fieldTask.findUnique({
      where: { id: capture.taskId },
      include: { project: { select: { id: true, latitude: true, longitude: true } } },
    });
    // Another NGO's task is "not found", not a hint that it exists.
    if (!task || task.ngoId !== actor.ngoId) return fail(404, "TASK_NOT_FOUND", "Task not found");
    if (task.assignedToId !== userId && !canManageTasks(actor)) {
      return fail(403, "TASK_NOT_ASSIGNED", "This task is assigned to someone else.");
    }

    const replay = await findReplay(capture.clientId, capture.feedback?.clientId ?? null, actor.ngoId);
    if (replay) return replay;

    if (task.status === "CANCELLED" || task.status === "COMPLETED") {
      return fail(409, "TASK_CLOSED", `This task is ${task.status.toLowerCase()}.`);
    }

    const photo = form.get("photo");
    const hasPhoto = photo instanceof Blob && photo.size > 0;
    if (!hasPhoto && !capture.feedback) {
      return fail(400, "NOTHING_TO_SYNC", "Send a photo, beneficiary feedback, or both.");
    }

    let evidenceData: Record<string, unknown> | null = null;
    let duplicate: DuplicateResult | null = null;
    let duplicateCheck: "DONE" | "FAILED" | "SKIPPED" = "SKIPPED";
    if (hasPhoto) {
      if (photo.size > MAX_PHOTO_BYTES) return fail(413, "PHOTO_TOO_LARGE", "Photo is larger than 8 MB.");
      const bytes = Buffer.from(await photo.arrayBuffer());
      // The type is sniffed from the bytes; the client's Content-Type and file
      // name are never trusted.
      const kind = sniffImage(bytes);
      if (!kind) return fail(415, "UNSUPPORTED_MEDIA_TYPE", `Photo must be a ${ACCEPTED_PHOTO_TYPES} image.`);

      const photoSha256 = createHash("sha256").update(bytes).digest("hex");
      // Same verdict table as milestone proofs, over BOTH evidence tables, so a
      // photo cannot cross from one submission path to the other unseen.
      // Best-effort: a failed lookup stores a null verdict ("not checked"),
      // never "NONE", and never costs the field worker the capture.
      try {
        const prior = await findPriorEvidence([photoSha256]);
        duplicate = classifyDuplicate(prior, {
          milestoneId: evidenceSlot(task.milestoneId, task.id),
          projectId: task.projectId,
          ngoId: task.ngoId,
        });
        duplicateCheck = "DONE";
      } catch (dupErr) {
        // DUPLICATE_LOOKUP_FAILED is reported in the response (duplicateCheck)
        // and the row stores a null verdict, which the review queue shows as
        // "duplicate check unavailable" — never as "no duplicate".
        duplicateCheck = "FAILED";
        console.error("[api/field/evidence] DUPLICATE_LOOKUP_FAILED:", dupErr);
      }
      const location = classifyProofLocation(
        capture.latitude !== null ? { latitude: capture.latitude, longitude: capture.longitude! } : null,
        task.project.latitude !== null && task.project.longitude !== null
          ? { latitude: task.project.latitude, longitude: task.project.longitude }
          : null,
      );

      try {
        uploadedKey = await uploadPrivateFile(bytes, kind.ext, "field-evidence");
      } catch (storageErr) {
        console.error("[api/field/evidence] STORAGE_UPLOAD_FAILED:", storageErr);
        if (isStorageError(storageErr) && storageErr.code === "STORAGE_NOT_CONFIGURED") {
          return fail(503, "STORAGE_NOT_CONFIGURED", "Photo storage is not configured on this server. The capture is kept on your phone; tell your administrator.");
        }
        return fail(503, "STORAGE_UPLOAD_FAILED", "The photo could not be stored. It is kept on your phone and will be retried.");
      }
      evidenceData = {
        taskId: task.id,
        ngoId: task.ngoId,
        projectId: task.projectId,
        milestoneId: task.milestoneId,
        capturedById: userId,
        clientId: capture.clientId,
        photoKey: uploadedKey,
        photoMime: kind.mime,
        photoSha256,
        duplicateOfId: duplicate?.matches.find((m) => m.source === "FIELD_EVIDENCE")?.proofId ?? null,
        duplicateVerdict: duplicate?.verdict ?? null,
        latitude: capture.latitude,
        longitude: capture.longitude,
        accuracyM: capture.accuracyM,
        locationStatus: location.status,
        distanceKm: location.distanceKm,
        note: capture.note,
        containsPeople: capture.containsPeople,
        capturedAt: capture.capturedAt,
      };
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const evidence = evidenceData ? await tx.fieldEvidence.create({ data: evidenceData as any }) : null;
        const feedback = capture.feedback
          ? await tx.beneficiaryFeedback.create({
              data: {
                ...capture.feedback,
                ngoId: task.ngoId,
                projectId: task.projectId,
                taskId: task.id,
                evidenceId: evidence?.id ?? null,
                capturedById: userId,
                capturedAt: capture.capturedAt,
              },
            })
          : null;
        if (evidence && task.status === "OPEN") {
          await tx.fieldTask.update({ where: { id: task.id }, data: { status: "SUBMITTED" } });
        }
        return { evidence, feedback };
      });
      // Committed: the stored photo now belongs to a row and must never be
      // cleaned up by a later failure (alert, response building).
      uploadedKey = null;

      // Only after the row committed, so a failed sync never leaves an alert
      // pointing at evidence that does not exist. createFraudAlert dedupes on
      // its description, which names the colliding row.
      const severity = duplicate ? duplicateSeverity(duplicate.verdict) : null;
      if (duplicate && severity) {
        try {
          await createFraudAlert(
            "PROOF_DUPLICATE_MEDIA",
            task.ngoId,
            "NGO",
            buildDuplicateDescription(duplicate, task.title),
            severity,
            "FRAUD_ALERT",
          );
        } catch (alertErr) {
          console.error("[api/field/evidence] duplicate alert failed:", alertErr);
        }
      }
      return NextResponse.json(
        {
          evidence: result.evidence && {
            id: result.evidence.id,
            status: result.evidence.status,
            locationStatus: result.evidence.locationStatus,
            duplicate: isDuplicate(result.evidence.duplicateVerdict, result.evidence.duplicateOfId),
            duplicateVerdict: result.evidence.duplicateVerdict,
            duplicateCheck,
          },
          feedbackId: result.feedback?.id ?? null,
        },
        { status: 201 },
      );
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        // The same capture is being synced concurrently; the other request won.
        const replayAfterRace = await findReplay(capture.clientId, capture.feedback?.clientId ?? null, actor.ngoId);
        if (replayAfterRace) {
          await cleanup(uploadedKey);
          return replayAfterRace;
        }
      }
      await cleanup(uploadedKey);
      console.error("[api/field/evidence] EVIDENCE_SAVE_FAILED:", err);
      return fail(500, "EVIDENCE_SAVE_FAILED", "The capture could not be saved. It is kept on your phone and will be retried.");
    }
  } catch (error) {
    await cleanup(uploadedKey);
    console.error("[api/field/evidence] POST error:", error);
    return fail(500, "SYNC_FAILED", "Failed to sync capture");
  }
}

async function cleanup(key: string | null) {
  if (key) await deletePrivateFile(key).catch(() => {});
}

/** A capture already stored: its result for this NGO, a conflict for anyone else. */
async function findReplay(clientId: string, feedbackClientId: string | null, ngoId: string) {
  const evidence = await prisma.fieldEvidence.findUnique({
    where: { clientId },
    select: { id: true, ngoId: true, status: true, locationStatus: true, duplicateOfId: true, duplicateVerdict: true },
  });
  const feedback = feedbackClientId
    ? await prisma.beneficiaryFeedback.findUnique({ where: { clientId: feedbackClientId }, select: { id: true, ngoId: true } })
    : null;
  if (!evidence && !feedback) return null;
  if ((evidence && evidence.ngoId !== ngoId) || (feedback && feedback.ngoId !== ngoId)) {
    return fail(409, "CLIENT_ID_CONFLICT", "clientId already used.");
  }
  return NextResponse.json(
    {
      evidence: evidence && {
        id: evidence.id,
        status: evidence.status,
        locationStatus: evidence.locationStatus,
        duplicate: isDuplicate(evidence.duplicateVerdict, evidence.duplicateOfId),
      },
      feedbackId: feedback?.id ?? null,
      replayed: true,
    },
    { status: 200 },
  );
}

/** Rows from before duplicateVerdict existed only carry duplicateOfId. */
function isDuplicate(verdict: string | null | undefined, duplicateOfId: string | null | undefined): boolean {
  if (verdict) return verdict !== "NONE";
  return !!duplicateOfId;
}
