import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { runMatchingJob } from "@/lib/matching/runner";

export const runtime = "nodejs";

/**
 * ADMIN-only. Start a matching run for one opportunity.
 *
 * The job runs to completion inside this request — the same shape as
 * FraudInvestigation, which also has no worker or queue. The QUEUED status and
 * the claim compare-and-swap inside runMatchingJob are the seams a real worker
 * slots into later without a schema change.
 */
export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const { opportunityId } = await request.json();
    if (!opportunityId || typeof opportunityId !== "string") {
      return NextResponse.json({ error: "opportunityId is required" }, { status: 400 });
    }

    const opportunity = await prisma.fundingOpportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true, status: true, _count: { select: { criteria: true } } },
    });
    if (!opportunity) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }
    if (opportunity.status !== "OPEN") {
      return NextResponse.json(
        { error: `Only an open opportunity can be matched (current status: ${opportunity.status}).` },
        { status: 409 }
      );
    }
    if (opportunity._count.criteria === 0) {
      return NextResponse.json(
        { error: "This opportunity declares no criteria, so there is nothing to match against." },
        { status: 400 }
      );
    }

    // A courtesy check for a good error message. The real guarantee against a
    // double run is the claim CAS in runMatchingJob plus the unique key on
    // (jobId, ngoId) — not this read.
    const inFlight = await prisma.matchingJob.findFirst({
      where: { opportunityId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    if (inFlight) {
      return NextResponse.json(
        { error: "A matching run is already in progress for this opportunity.", jobId: inFlight.id },
        { status: 409 }
      );
    }

    const job = await prisma.matchingJob.create({
      data: { opportunityId, status: "QUEUED", triggeredById: adminId },
      select: { id: true },
    });

    const counts = await runMatchingJob(job.id);

    if (!counts) {
      await logAdminAction({
        adminId,
        action: "MATCHING_JOB_FAILED",
        entityType: "MATCHING_JOB",
        entityId: job.id,
        metadata: { opportunityId },
        request,
      });
      return NextResponse.json(
        { jobId: job.id, status: "FAILED", error: "The matching run did not complete. See the job for details." },
        { status: 500 }
      );
    }

    await logAdminAction({
      adminId,
      action: "MATCHING_JOB_STARTED",
      entityType: "MATCHING_JOB",
      entityId: job.id,
      // Ids and counts only.
      metadata: { opportunityId, criteriaCount: opportunity._count.criteria, ...counts },
      request,
    });

    return NextResponse.json({ jobId: job.id, status: "COMPLETED", ...counts }, { status: 201 });
  } catch (err: any) {
    console.error("Failed to start matching job:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
