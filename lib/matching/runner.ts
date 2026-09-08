import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { evaluateEligibility } from "./eligibility";
import { gatherEligibilityInputs } from "./gather";
import { pruneStaleCandidates, upsertCandidate } from "./store";
import type { CriterionSpec, EligibilityResult } from "./types";

/**
 * Executes one matching job.
 *
 * Runs synchronously inside the request that starts it — the same shape as
 * FraudInvestigation, which also runs to completion in one call with no worker
 * or queue. `QUEUED` plus the claim compare-and-swap below are the seams a real
 * worker slots into later without a schema change.
 */

export interface JobCounts {
  evaluatedCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  unknownCount: number;
}

/** Beyond this, a RUNNING job is assumed stranded and may be requeued. */
export const STRANDED_AFTER_MS = 5 * 60 * 1000;

/** Cap on one run, matching the `take: 100` discipline of the admin catalogues. */
const MAX_POOL = 500;

/**
 * @returns the counts on success, or `null` if the job could not be claimed
 * (already running, already finished, or claimed by someone else).
 */
export async function runMatchingJob(jobId: string): Promise<JobCounts | null> {
  // Claim by compare-and-swap. Two concurrent runners — or one double-clicked
  // button — cannot both execute this job. A bare `update` by id would be a
  // race, which is why every state transition in this codebase is a CAS.
  const claim = await prisma.matchingJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });
  if (claim.count === 0) return null;

  try {
    const job = await prisma.matchingJob.findUnique({
      where: { id: jobId },
      select: { opportunityId: true },
    });
    if (!job) throw new Error("Job disappeared after being claimed");

    const criteriaRows = await prisma.opportunityCriterion.findMany({
      where: { opportunityId: job.opportunityId },
      orderBy: { createdAt: "asc" },
      select: { kind: true, value: true, values: true, required: true },
    });
    const criteria: CriterionSpec[] = criteriaRows.map((c) => ({
      kind: c.kind,
      value: c.value,
      values: c.values,
      required: c.required,
    }));

    // Freeze the rules this run was judged against. Without this, editing the
    // opportunity later silently rewrites the criteria an old result appears to
    // have been measured by, and a stored rejection reason stops matching the
    // criteria displayed above it.
    await prisma.matchingJob.update({
      where: { id: jobId },
      data: { criteriaSnapshot: criteria as any },
    });

    // Eligibility to be MATCHED is a precondition, not a criterion.
    //
    // This used to include unverified and suspended organisations, on the
    // reasoning that a visible, reasoned rejection beats an invisible one. That
    // is right in the verification queue and wrong here: an organisation that
    // is not verified cannot receive funding at all, so listing it against a
    // funder's opportunity is noise rather than transparency — and it puts
    // organisations nobody has vetted in front of a funder.
    //
    // Pending and suspended organisations belong in /admin/verification, which
    // exists for exactly that. The VERIFIED_STATUS and NOT_SUSPENDED rules stay
    // available and now pass trivially, which is honest: they state the
    // precondition on the record rather than leaving it implicit.
    const pool = await prisma.nGOProfile.findMany({
      where: { isDeleted: false, isSuspended: false, verificationStatus: "VERIFIED" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: MAX_POOL,
    });

    const asOf = new Date();
    const inputs = await gatherEligibilityInputs(
      pool.map((n) => n.id),
      asOf
    );

    const counts: JobCounts = {
      evaluatedCount: 0,
      eligibleCount: 0,
      ineligibleCount: 0,
      unknownCount: 0,
    };

    // Sequential, not Promise.all: the same connection-pool discipline
    // refreshAllNgoScores documents. A matching run is not latency-critical.
    for (const { id: ngoId } of pool) {
      let result: EligibilityResult;
      try {
        const input = inputs.get(ngoId);
        if (!input) throw new Error("No gathered input for this organisation");
        result = evaluateEligibility(input, criteria);
      } catch (err) {
        // One organisation failing must not blank the whole shortlist. Record
        // it as UNKNOWN — which is honest — and carry on.
        captureError(
          err,
          {
            scope: "lib/matching/runner",
            operation: "evaluate_candidate",
            entityType: "NGO",
            entityId: ngoId,
            extra: { jobId },
          },
          "warning"
        );
        result = {
          verdict: "UNKNOWN",
          results: [],
          summary: "Evaluation failed for this organisation, so it was not judged.",
        };
      }

      await upsertCandidate(jobId, ngoId, result);

      counts.evaluatedCount += 1;
      if (result.verdict === "ELIGIBLE") counts.eligibleCount += 1;
      else if (result.verdict === "INELIGIBLE") counts.ineligibleCount += 1;
      else counts.unknownCount += 1;
    }

    // An organisation that has left the pool since the last run must not stay
    // on the board — otherwise the rows and the counts tell different stories.
    await pruneStaleCandidates(
      jobId,
      pool.map((n) => n.id)
    );

    await prisma.matchingJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "COMPLETED", finishedAt: new Date(), ...counts },
    });

    return counts;
  } catch (err: any) {
    // A job must never be left stuck in RUNNING with nothing to explain it.
    // This write is itself wrapped, so a failure to record the failure cannot
    // propagate and mask the original error.
    try {
      await prisma.matchingJob.updateMany({
        where: { id: jobId, status: "RUNNING" },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          // Message only, truncated. A stack can carry paths and query
          // fragments, and this column is rendered in the admin UI.
          errorMessage: String(err?.message ?? "Unknown error").slice(0, 500),
        },
      });
    } catch {
      /* deliberately swallowed — captureError below is the record */
    }

    captureError(
      err,
      {
        scope: "lib/matching/runner",
        operation: "run_matching_job",
        entityType: "MATCHING_JOB",
        entityId: jobId,
      },
      "fatal"
    );
    return null;
  }
}
