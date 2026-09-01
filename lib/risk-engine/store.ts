import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import type { RiskEntityType } from "@prisma/client";
import { scoreNgo } from "./ngo";
import { scoreDonor } from "./donor";
import type { RiskScoreResult } from "./types";

/**
 * Persistence for the two engines.
 *
 * The stored row is a materialised ranking value, not a source of truth: the
 * inputs stay derived on read wherever they already are (computeCompliance is
 * still never stored), and `computedAt` travels with the score so a stale one
 * is visibly stale. It exists only because a worst-first page cannot sort or
 * paginate over a value computed per row — the same lesson the platform sweep
 * taught when it was 466ms of a 624ms page load.
 *
 * Nothing here writes an alert, opens a review, or notifies anyone. Scoring is
 * measurement; acting on a score is a separate decision that belongs to the
 * aggregator, behind its own explicit switch.
 */

export async function storeRiskScore(
  entityType: RiskEntityType,
  entityId: string,
  result: RiskScoreResult
): Promise<void> {
  const data = {
    score: result.score,
    band: result.band,
    signals: result.signals as any,
    unknownInputs: result.unknownInputs,
    computedAt: new Date(),
  };

  await prisma.entityRiskScore.upsert({
    where: { entityType_entityId: { entityType, entityId } },
    create: { entityType, entityId, ...data },
    update: data,
  });
}

/**
 * Recompute and store one entity's score.
 *
 * Never throws: this is called from the edges of other operations (an alert
 * being raised, a document being validated) and a scoring failure must not fail
 * the thing that triggered it — the same discipline the audit log and health
 * score recalculation already follow. A failure that is swallowed here is still
 * reported through captureError.
 */
export async function refreshRiskScore(
  entityType: RiskEntityType,
  entityId: string
): Promise<RiskScoreResult | null> {
  try {
    const result = entityType === "NGO" ? await scoreNgo(entityId) : await scoreDonor(entityId);
    if (result === null) return null;
    await storeRiskScore(entityType, entityId, result);
    return result;
  } catch (err) {
    captureError(err, {
      scope: "lib/risk-engine/store",
      operation: "refresh_risk_score",
      entityType,
      entityId,
    });
    return null;
  }
}

/**
 * Recompute every NGO score. Intended for a scheduled sweep, not a request.
 *
 * Sequential on purpose: each entity costs several queries, and a burst of
 * parallel scoring against a serverless Postgres connection pool is a good way
 * to starve the requests that actual users are waiting on. A sweep that takes
 * longer but stays out of the way is the right trade for maintenance work.
 */
export async function refreshAllNgoScores(): Promise<{ scored: number; failed: number }> {
  const ngos = await prisma.nGOProfile.findMany({
    where: { isDeleted: false },
    select: { id: true },
  });

  let scored = 0;
  let failed = 0;
  for (const ngo of ngos) {
    const result = await refreshRiskScore("NGO", ngo.id);
    if (result === null) failed += 1;
    else scored += 1;
  }
  return { scored, failed };
}

/**
 * Recompute every donor score.
 *
 * Scoped to donors who have actually given: a donor with no successful donation
 * has nothing to assess, and scoring them would fill the ranking with rows that
 * mean nothing. They get a score the moment their first donation succeeds.
 */
export async function refreshAllDonorScores(): Promise<{ scored: number; failed: number }> {
  const donors = await prisma.user.findMany({
    where: { role: "DONOR", donations: { some: { status: "SUCCESS" } } },
    select: { id: true },
  });

  let scored = 0;
  let failed = 0;
  for (const donor of donors) {
    const result = await refreshRiskScore("DONOR", donor.id);
    if (result === null) failed += 1;
    else scored += 1;
  }
  return { scored, failed };
}
