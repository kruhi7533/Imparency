import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import type { RiskEntityType } from "@prisma/client";
import { investigate } from "@/lib/fraud-investigator/run";
import { BACKGROUND_WALL_CLOCK_MS, INVESTIGATOR_ENABLED } from "@/lib/fraud-investigator/config";
import { runAndStoreNgoExtraction } from "@/lib/extraction-runner";
import { routeFor } from "./router";
import { refreshRiskScore } from "./store";
import type { RiskScoreResult } from "./types";

/**
 * The queue between the Radar and the expensive work.
 *
 * Two halves, deliberately separated:
 *   enqueue — cheap, decides what SHOULD happen, writes rows.
 *   drain   — expensive, does a bounded amount of it.
 *
 * They are split because the throughput ceiling is real and low: measured
 * 2026-08-26, an investigation takes ~6 minutes and ~35k tokens against a
 * free-tier cap that binds hard. Deciding and doing in one pass would mean a
 * sweep that scores 500 NGOs tries to launch 40 investigations at once, and
 * they starve each other on tokens. Split, the budget is one number.
 */

/** How many dispatches one drain will actually execute. */
export const DISPATCH_BUDGET = Number.parseInt(process.env.RISK_DISPATCH_MAX_PER_RUN ?? "", 10) || 3;

/**
 * Don't re-queue the same action for the same entity this often.
 *
 * Without it, a nightly sweep would re-investigate the same HIGH NGO every
 * single night for as long as it stays HIGH — which it will, because an open
 * risk review is one of the things that MAKES it high. The score is a standing
 * condition, not an event, so the queue needs its own sense of "we already did
 * this recently".
 */
export const REDISPATCH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export interface EnqueueSummary {
  investigate: number;
  extract: number;
  monitor: number;
  skippedRecent: number;
}

/**
 * Decide what to do about every current score and queue it.
 *
 * MONITOR decisions are recorded too. It costs one row and it is the difference
 * between "the system considered this NGO and decided it did not warrant
 * spending" and "the system never looked" — which is the same distinction the
 * UNKNOWN band exists to protect, applied to the routing layer.
 */
export async function enqueueFromScores(): Promise<EnqueueSummary> {
  const scores = await prisma.entityRiskScore.findMany({
    orderBy: { score: "desc" },
  });

  const summary: EnqueueSummary = { investigate: 0, extract: 0, monitor: 0, skippedRecent: 0 };
  const cooldownStart = new Date(Date.now() - REDISPATCH_COOLDOWN_MS);

  for (const row of scores) {
    const result: RiskScoreResult = {
      score: row.score,
      band: row.band,
      unknownInputs: row.unknownInputs,
      signals: (Array.isArray(row.signals) ? row.signals : []) as any,
    };
    const route = routeFor(row.entityType, result);

    // Already queued or running for this entity: leave it alone. One open
    // dispatch per entity is the invariant that stops a nightly sweep from
    // building a backlog it can never drain.
    const open = await prisma.riskDispatch.findFirst({
      where: { entityType: row.entityType, entityId: row.entityId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true },
    });
    if (open) {
      summary.skippedRecent += 1;
      continue;
    }

    if (route.action !== "MONITOR") {
      const recent = await prisma.riskDispatch.findFirst({
        where: {
          entityType: row.entityType,
          entityId: row.entityId,
          action: route.action,
          status: "DONE",
          finishedAt: { gte: cooldownStart },
        },
        select: { id: true },
      });
      if (recent) {
        summary.skippedRecent += 1;
        continue;
      }
    }

    // The dispatch table is not the only way an investigation happens: the
    // alert trigger (lib/fraud-investigator/trigger.ts) and the admin's manual
    // "Investigate" button both run outside this queue. Checking only our own
    // rows would re-investigate an NGO the alert path examined an hour ago and
    // spend a scarce daily slot learning nothing — so look at what actually
    // ran, not at what we remember queuing.
    if (route.action === "INVESTIGATE") {
      const recentRun = await prisma.fraudInvestigation.findFirst({
        where: { ngoId: row.entityId, status: "COMPLETED", createdAt: { gte: cooldownStart } },
        select: { id: true },
      });
      if (recentRun) {
        summary.skippedRecent += 1;
        continue;
      }
    }

    await prisma.riskDispatch.create({
      data: {
        entityType: row.entityType,
        entityId: row.entityId,
        action: route.action,
        // MONITOR is a decision, not work — it is complete the moment it is made.
        status: route.action === "MONITOR" ? "DONE" : "QUEUED",
        finishedAt: route.action === "MONITOR" ? new Date() : null,
        scoreAtQueue: row.score,
        bandAtQueue: row.band,
        reason: route.reason,
      },
    });

    if (route.action === "INVESTIGATE") summary.investigate += 1;
    else if (route.action === "EXTRACT") summary.extract += 1;
    else summary.monitor += 1;
  }

  return summary;
}

export interface DrainSummary {
  ran: number;
  done: number;
  failed: number;
  budget: number;
}

/**
 * Execute up to DISPATCH_BUDGET queued dispatches, worst score first.
 *
 * Sequential on purpose — the whole reason this is a queue is that these cannot
 * safely run in parallel.
 */
export async function drainDispatches(budget = DISPATCH_BUDGET): Promise<DrainSummary> {
  const due = await prisma.riskDispatch.findMany({
    where: { status: "QUEUED" },
    orderBy: [{ scoreAtQueue: "desc" }, { queuedAt: "asc" }],
    take: budget,
  });

  const summary: DrainSummary = { ran: 0, done: 0, failed: 0, budget };

  for (const dispatch of due) {
    await prisma.riskDispatch.update({
      where: { id: dispatch.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    summary.ran += 1;

    try {
      const resultRef = await execute(dispatch.action, dispatch.entityType, dispatch.entityId, dispatch.id);
      await prisma.riskDispatch.update({
        where: { id: dispatch.id },
        data: { status: "DONE", finishedAt: new Date(), resultRef },
      });
      summary.done += 1;

      // Whatever just ran changed what we know about this entity, so the score
      // that queued it is now out of date. Re-score immediately rather than
      // waiting for the next sweep — otherwise an NGO whose documents were just
      // read stays banded UNKNOWN until tomorrow and gets queued for extraction
      // all over again.
      await refreshRiskScore(dispatch.entityType, dispatch.entityId);
    } catch (err: any) {
      captureError(err, {
        scope: "lib/risk-engine/dispatch",
        operation: `execute_${dispatch.action.toLowerCase()}`,
        entityType: dispatch.entityType,
        entityId: dispatch.entityId,
      });
      await prisma.riskDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          error: String(err?.message ?? err).slice(0, 500),
        },
      });
      summary.failed += 1;
    }
  }

  return summary;
}

async function execute(
  action: string,
  entityType: RiskEntityType,
  entityId: string,
  dispatchId: string
): Promise<string | null> {
  if (action === "EXTRACT") {
    const fields = await runAndStoreNgoExtraction(entityId);
    return `${Array.isArray(fields) ? fields.length : 0} field(s) extracted`;
  }

  if (action === "INVESTIGATE") {
    if (!INVESTIGATOR_ENABLED) {
      throw new Error("INVESTIGATOR_ENABLED is not 'true' — nothing to dispatch to.");
    }
    // No alert id: this run was justified by a standing score, not by a single
    // event. triggeredBy records which dispatch decided it, so the trace leads
    // back to the score that spent the budget.
    const result = await investigate(entityId, null, `radar:${dispatchId}`, {
      wallClockMs: BACKGROUND_WALL_CLOCK_MS,
    });
    if (result.status === "FAILED") {
      throw new Error(result.summary ?? "Investigation did not complete.");
    }
    return result.investigationId;
  }

  throw new Error(`Nothing to execute for action ${action}.`);
}
