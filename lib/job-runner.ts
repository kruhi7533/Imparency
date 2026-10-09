import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { log } from "@/lib/logger";
import { withRequestContext } from "@/lib/request-context";
import { jobByName } from "@/lib/job-registry";

/**
 * The seam every scheduled job runs through, so that a job which stops working
 * becomes visible without anyone thinking to look.
 *
 * ## The problem this closes
 *
 * There are nine cron routes and, before this, no record anywhere that any of
 * them ever ran. Nothing said "job X started at T, took Yms, processed Z rows,
 * succeeded". The consequence is not that jobs fail — it is that **nobody can
 * tell the difference between a job that was never scheduled and one that has
 * been failing every night for a month.** On the dev database there are six
 * impact events, three subscriptions and zero deliveries, and that fact alone
 * cannot distinguish the two. The Pilot Gate's "failed-job visibility (ops
 * console)" had nothing to render.
 *
 * ## What it guarantees
 *
 * 1. **A ledger row per attempt**, including attempts that fail or are skipped.
 * 2. **A correlation id** shared by the row and every log line the job emits,
 *    so `/admin/ops` can hand an investigator one id (SPEC-1).
 * 3. **A ledger failure never fails the job.** Writing the row is a secondary
 *    concern, exactly like the audit log, and must not break the primary work.
 *    This is the rule the codebase already applies everywhere else, turned on
 *    the thing that watches the codebase.
 */

export type JobTrigger = "CRON" | "MANUAL" | "BACKFILL";

export interface JobHandle {
  correlationId: string;
  /**
   * How many things this run actually did.
   *
   * Reported rather than inferred, because only the job knows. `0` is a
   * healthy answer — a nightly drainer with an empty queue did its job — and
   * conflating "processed nothing" with "failed" is how a real alert gets
   * buried among false ones.
   */
  recordItems(count: number | null): void;
}

/**
 * Best-effort item count from whatever a job body returned.
 *
 * Returns null — "did not say" — rather than guessing a number, because a
 * fabricated `0` is indistinguishable on the ops console from a real run that
 * found nothing to do, and the whole point of the column is telling those
 * apart.
 */
export function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["processed", "count", "total", "sent"]) {
      if (typeof record[key] === "number") return record[key] as number;
    }
  }
  return null;
}

export type JobOutcome<T> =
  | { skipped: true; reason: string }
  | { skipped: false; value: T };

/** A RUNNING row older than the job's budget is wreckage, not work in flight. */
function staleBefore(name: string, now: Date): Date {
  const def = jobByName(name);
  const minutes = def?.maxRuntimeMinutes ?? 30;
  return new Date(now.getTime() - minutes * 60_000);
}

/**
 * Run `body` as a recorded job.
 *
 * @example
 * export async function GET(req: Request) {
 *   // ... CRON_SECRET check first: a rejected call must not create a row ...
 *   const outcome = await runJob("fcra-expiry", { req }, async (job) => {
 *     const results = await runFcraExpiryMaintenance();
 *     job.recordItems(results.length);
 *     return NextResponse.json({ ok: true, results });
 *   });
 *   if (outcome.skipped) return NextResponse.json({ ok: true, skipped: outcome.reason });
 *   return outcome.value;
 * }
 */
export async function runJob<T>(
  name: string,
  options: { req?: Request; trigger?: JobTrigger; inboundTraceparent?: string | null },
  body: (job: JobHandle) => Promise<T>
): Promise<JobOutcome<T>> {
  const trigger: JobTrigger = options.trigger ?? "CRON";
  const inbound =
    options.inboundTraceparent ?? options.req?.headers.get("traceparent") ?? null;

  return withRequestContext(
    { scope: `cron/${name}`, inboundTraceparent: inbound },
    async (ctx) => {
      const startedAt = new Date();
      let itemsProcessed: number | null = null;

      const handle: JobHandle = {
        correlationId: ctx.correlationId,
        recordItems: (count: number) => {
          itemsProcessed = count;
        },
      };

      // --- open the ledger row ------------------------------------------
      // If this write fails the job still runs. An unrecorded run is a
      // monitoring gap; a job that refused to run because monitoring was down
      // is an outage caused by the monitoring.
      let runId: string | null = null;
      try {
        const row = await prisma.jobRun.create({
          data: {
            job: name,
            status: "RUNNING",
            startedAt,
            trigger,
            correlationId: ctx.correlationId,
          },
          select: { id: true },
        });
        runId = row.id;
      } catch (err) {
        captureError(err, { scope: "lib/job-runner", operation: "open_run", extra: { job: name } });
      }

      // --- concurrency ---------------------------------------------------
      // Both contenders insert, then the later one backs off. Deterministic
      // (earliest startedAt wins, id breaks a tie) and needs no lock, which
      // matters because the app talks to Neon through a pooler where a
      // session-scoped advisory lock would not survive.
      //
      // A partial unique index on (job) WHERE status = 'RUNNING' would be
      // stricter, but Prisma cannot express a partial index, so the database
      // would carry an object schema.prisma does not declare — and CI's
      // "check schema and migrations agree" gate would fail on it. That gate
      // caught four real defects this week; working around it would be a poor
      // trade for a guard the jobs do not strictly need, since every one of
      // them has to be replay-safe anyway.
      if (runId) {
        try {
          const now = new Date();
          const competitor = await prisma.jobRun.findFirst({
            where: {
              job: name,
              status: "RUNNING",
              id: { not: runId },
              startedAt: { gte: staleBefore(name, now) },
            },
            orderBy: [{ startedAt: "asc" }, { id: "asc" }],
            select: { id: true, startedAt: true },
          });

          const weLose =
            competitor !== null &&
            (competitor.startedAt.getTime() < startedAt.getTime() ||
              (competitor.startedAt.getTime() === startedAt.getTime() && competitor.id < runId));

          if (weLose) {
            const reason = "another run of this job is already in progress";
            await finish(runId, {
              status: "SKIPPED",
              startedAt,
              itemsProcessed: null,
              errorName: null,
              errorMessage: null,
            });
            log.info("job.skipped", { job: name, reason });
            return { skipped: true, reason };
          }
        } catch (err) {
          // Could not check: run anyway. The jobs are replay-safe, so a
          // duplicate run is cheaper than a silently skipped one.
          captureError(err, {
            scope: "lib/job-runner",
            operation: "concurrency_check",
            extra: { job: name },
          });
        }
      }

      // --- the work ------------------------------------------------------
      log.info("job.started", { job: name, trigger });
      try {
        const value = await body(handle);
        await finish(runId, {
          status: "SUCCEEDED",
          startedAt,
          itemsProcessed,
          errorName: null,
          errorMessage: null,
        });
        log.info("job.succeeded", {
          job: name,
          durationMs: Date.now() - startedAt.getTime(),
          itemsProcessed,
        });
        return { skipped: false, value };
      } catch (err) {
        const name_ = err instanceof Error ? err.name : "NonError";
        const message = err instanceof Error ? err.message : String(err);

        await finish(runId, {
          status: "FAILED",
          startedAt,
          itemsProcessed,
          errorName: name_,
          // Truncated: the column is for triage, not for storing a payload
          // someone pasted into an error message.
          errorMessage: message.slice(0, 500),
        });

        captureError(err, { scope: `cron/${name}`, operation: "scheduled_run" });
        log.error("job.failed", {
          job: name,
          durationMs: Date.now() - startedAt.getTime(),
          errorName: name_,
        });

        // Rethrown so the route keeps its existing 500 behaviour. The ledger
        // records the failure either way.
        throw err;
      }
    }
  );
}

/** Close a ledger row. Never throws — see the guarantee above. */
async function finish(
  runId: string | null,
  data: {
    status: "SUCCEEDED" | "FAILED" | "SKIPPED";
    startedAt: Date;
    itemsProcessed: number | null;
    errorName: string | null;
    errorMessage: string | null;
  }
): Promise<void> {
  if (!runId) return;
  const finishedAt = new Date();
  try {
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        status: data.status,
        finishedAt,
        durationMs: finishedAt.getTime() - data.startedAt.getTime(),
        itemsProcessed: data.itemsProcessed,
        errorName: data.errorName,
        errorMessage: data.errorMessage,
      },
    });
  } catch (err) {
    captureError(err, { scope: "lib/job-runner", operation: "close_run" });
  }
}
