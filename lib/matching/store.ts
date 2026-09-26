import prisma from "@/lib/prisma";
import type { EligibilityResult } from "./types";

/**
 * Persistence only. Nothing here decides anything — no rule, no threshold, no
 * verdict. Same discipline as lib/risk-engine/store.ts.
 */

/**
 * Write one organisation's result for one job.
 *
 * Upserts on the `@@unique([jobId, ngoId])` key, so idempotency is guaranteed
 * by the database rather than by application logic: re-running a job can never
 * double-write a candidate.
 *
 * The `update` payload deliberately omits `decision`, `decidedById`,
 * `decidedAt` and `decisionNote`. A re-run refreshes the MACHINE's proposal and
 * must never reset a HUMAN's decision on it — that separation is the whole
 * reason verdict and decision are different columns.
 */
/**
 * Drop candidates this run did not evaluate.
 *
 * An organisation can leave the pool between runs — it gets suspended, or its
 * verification is revoked. Its row from the previous run would otherwise linger
 * and be shown to a funder, while the job's own counts said it was never
 * evaluated. Same job, two contradictory answers.
 *
 * Only PROPOSED rows are pruned. A shortlisted or dismissed candidate records a
 * decision a person made, and re-running the machine must never erase that —
 * the same rule that keeps the decision columns out of the upsert below.
 */
export async function pruneStaleCandidates(
  jobId: string,
  evaluatedNgoIds: string[]
): Promise<number> {
  const { count } = await prisma.matchCandidate.deleteMany({
    where: {
      jobId,
      decision: "PROPOSED",
      ngoId: { notIn: evaluatedNgoIds },
    },
  });
  return count;
}

export async function upsertCandidate(
  jobId: string,
  ngoId: string,
  result: EligibilityResult
): Promise<void> {
  await prisma.matchCandidate.upsert({
    where: { jobId_ngoId: { jobId, ngoId } },
    create: {
      jobId,
      ngoId,
      verdict: result.verdict,
      reasons: result.results as any,
    },
    update: {
      verdict: result.verdict,
      reasons: result.results as any,
    },
  });
}
