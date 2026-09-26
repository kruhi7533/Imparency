import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { runMatchingJob, STRANDED_AFTER_MS } from "@/lib/matching/runner";

export const runtime = "nodejs";

/**
 * ADMIN-only. Re-run a finished job, or recover one that was stranded.
 *
 * Re-running is safe by construction: candidates upsert on (jobId, ngoId), and
 * the update deliberately omits the decision columns, so a re-run refreshes the
 * engine's proposal without disturbing any shortlisting an admin has done.
 *
 * A RUNNING job may only be requeued once it is old enough to be considered
 * stranded — the runner is synchronous, so a genuinely in-flight job would
 * otherwise be interrupted.
 */
export async function POST(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const job = await prisma.matchingJob.findUnique({
      where: { id: params.jobId },
      select: { id: true, status: true, startedAt: true, opportunityId: true },
    });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const strandedSince = new Date(Date.now() - STRANDED_AFTER_MS);
    const requeuable =
      job.status === "COMPLETED" || job.status === "FAILED"
        ? { id: params.jobId, status: job.status }
        : job.status === "RUNNING" && job.startedAt && job.startedAt < strandedSince
          ? { id: params.jobId, status: "RUNNING", startedAt: { lt: strandedSince } }
          : null;

    if (!requeuable) {
      return NextResponse.json(
        { error: `This job cannot be requeued from its current status (${job.status}).` },
        { status: 409 }
      );
    }

    const { count } = await prisma.matchingJob.updateMany({
      where: requeuable,
      data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "This job changed status while you were acting on it. Refresh and try again." },
        { status: 409 }
      );
    }

    const counts = await runMatchingJob(params.jobId);

    if (!counts) {
      await logAdminAction({
        adminId,
        action: "MATCHING_JOB_FAILED",
        entityType: "MATCHING_JOB",
        entityId: params.jobId,
        metadata: { opportunityId: job.opportunityId, requeued: true },
        request,
      });
      return NextResponse.json(
        { jobId: params.jobId, status: "FAILED", error: "The matching run did not complete." },
        { status: 500 }
      );
    }

    await logAdminAction({
      adminId,
      action: "MATCHING_JOB_STARTED",
      entityType: "MATCHING_JOB",
      entityId: params.jobId,
      metadata: { opportunityId: job.opportunityId, requeued: true, ...counts },
      request,
    });

    return NextResponse.json({ jobId: params.jobId, status: "COMPLETED", ...counts });
  } catch (err: any) {
    console.error("Failed to requeue matching job:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
