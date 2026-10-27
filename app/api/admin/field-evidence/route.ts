import { NextResponse } from "next/server";
import { FieldEvidenceStatus, Prisma, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { evidenceFlags, FLAGGED_EVIDENCE_WHERE, isBrowserRenderable } from "@/lib/field-evidence";
import { signEvidencePhotoPath } from "@/lib/evidence-photo-url";
import { duplicateLabel } from "@/lib/proof-fingerprint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/field-evidence — the evidence review queue (ADM-012).
 *
 * Filters (all optional, query string carries ids and enum values only — no
 * personal data):
 *   status     PENDING_REVIEW (default) | APPROVED | RESUBMIT_REQUESTED | REJECTED | ALL
 *   flag       any (flagged: duplicate image or GPS mismatch) | duplicate | gps | clean
 *   ngoId, projectId
 *   cursor     id of the last row of the previous page
 *
 * Each row carries its automatic flags ("AI flags, human decides") and a
 * signed, expiring photo link issued to this admin. Read-only; decisions go
 * through PATCH /api/admin/field-evidence/[id], which logs.
 */
const PAGE = 30;
const STATUSES = Object.values(FieldEvidenceStatus) as string[];

export async function GET(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  try {
    const url = new URL(request.url);
    const statusParam = (url.searchParams.get("status") || "PENDING_REVIEW").toUpperCase();
    if (statusParam !== "ALL" && !STATUSES.includes(statusParam)) {
      return NextResponse.json({ error: "Unknown status filter.", code: "INVALID_FILTER" }, { status: 400 });
    }
    const flag = (url.searchParams.get("flag") || "").toLowerCase();
    if (flag && !["any", "duplicate", "gps", "clean"].includes(flag)) {
      return NextResponse.json({ error: "Unknown flag filter.", code: "INVALID_FILTER" }, { status: 400 });
    }
    const ngoId = url.searchParams.get("ngoId")?.slice(0, 100) || null;
    const projectId = url.searchParams.get("projectId")?.slice(0, 100) || null;
    const cursor = url.searchParams.get("cursor")?.slice(0, 100) || null;

    const and: Prisma.FieldEvidenceWhereInput[] = [];
    if (statusParam !== "ALL") and.push({ status: statusParam as FieldEvidenceStatus });
    if (ngoId) and.push({ ngoId });
    if (projectId) and.push({ projectId });
    if (flag === "any") and.push(FLAGGED_EVIDENCE_WHERE as Prisma.FieldEvidenceWhereInput);
    if (flag === "duplicate") {
      and.push({ OR: [{ duplicateVerdict: { in: ["REUSED_IN_PROJECT", "CROSS_PROJECT"] } }, { duplicateVerdict: null, duplicateOfId: { not: null } }] });
    }
    if (flag === "gps") and.push({ locationStatus: "MISMATCH" });
    if (flag === "clean") and.push({ NOT: FLAGGED_EVIDENCE_WHERE as Prisma.FieldEvidenceWhereInput });
    const where: Prisma.FieldEvidenceWhereInput = and.length ? { AND: and } : {};

    const [rows, counts] = await Promise.all([
      prisma.fieldEvidence.findMany({
        where,
        // Oldest first: a queue, not a feed. id breaks ties for a stable cursor.
        orderBy: [{ syncedAt: "asc" }, { id: "asc" }],
        take: PAGE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          ngoId: true,
          projectId: true,
          taskId: true,
          status: true,
          photoMime: true,
          duplicateVerdict: true,
          duplicateOfId: true,
          locationStatus: true,
          distanceKm: true,
          accuracyM: true,
          note: true,
          containsPeople: true,
          capturedAt: true,
          syncedAt: true,
          reviewNote: true,
          reviewedAt: true,
          task: { select: { title: true, status: true, project: { select: { title: true, location: true, ngo: { select: { orgName: true } } } } } },
          feedback: { select: { consentToRecord: true, consentToSharePhoto: true, withdrawnAt: true, rating: true, feedbackText: true } },
        },
      }),
      prisma.fieldEvidence.groupBy({
        by: ["status"],
        where: { ...(ngoId ? { ngoId } : {}), ...(projectId ? { projectId } : {}) },
        _count: { _all: true },
      }),
    ]);

    const hasMore = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    const now = new Date();
    const items = page.map((e) => {
      const photo = signEvidencePhotoPath(e.id, session.user.id, now);
      return {
        id: e.id,
        ngoId: e.ngoId,
        projectId: e.projectId,
        taskId: e.taskId,
        status: e.status,
        orgName: e.task.project.ngo.orgName,
        taskTitle: e.task.title,
        taskStatus: e.task.status,
        projectTitle: e.task.project.title,
        projectLocation: e.task.project.location,
        photoUrl: photo.url,
        photoUrlExpiresAt: photo.expiresAt,
        photoMime: e.photoMime,
        photoRenderable: isBrowserRenderable(e.photoMime),
        flags: evidenceFlags(e),
        duplicate: duplicateLabel(e.duplicateVerdict),
        duplicateVerdict: e.duplicateVerdict,
        locationStatus: e.locationStatus,
        distanceKm: e.distanceKm,
        accuracyM: e.accuracyM,
        note: e.note,
        containsPeople: e.containsPeople,
        consentToShare: !!e.feedback?.consentToSharePhoto && !e.feedback.withdrawnAt,
        consentWithdrawn: !!e.feedback?.withdrawnAt,
        feedback:
          e.feedback && e.feedback.consentToRecord && !e.feedback.withdrawnAt
            ? { rating: e.feedback.rating, text: e.feedback.feedbackText }
            : null,
        capturedAt: e.capturedAt.toISOString(),
        syncedAt: e.syncedAt.toISOString(),
        offline: e.syncedAt.getTime() - e.capturedAt.getTime() > 10 * 60_000,
        reviewNote: e.reviewNote,
        reviewedAt: e.reviewedAt?.toISOString() ?? null,
      };
    });

    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const c of counts) byStatus[c.status] = c._count._all;

    return NextResponse.json({ items, nextCursor: hasMore ? page[page.length - 1].id : null, counts: byStatus });
  } catch (error) {
    console.error("[api/admin/field-evidence] GET error:", error);
    return NextResponse.json({ error: "Failed to load the evidence queue.", code: "QUEUE_LOAD_FAILED" }, { status: 500 });
  }
}
