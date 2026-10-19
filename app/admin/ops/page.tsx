import prisma from "@/lib/prisma";
import { Activity, CircleSlash, Clock } from "lucide-react";
import {
  JOBS,
  jobHealth,
  healthLabel,
  type JobDefinition,
  type JobHealth,
  type LastRunFacts,
} from "@/lib/job-registry";

/**
 * /admin/ops — is the scheduled work actually running? (Week 9 SPEC-2)
 *
 * The platform has nine cron routes and, until this week, no record that any of
 * them ever ran. That meant "never scheduled" and "failing every night for a
 * month" were indistinguishable — the Pilot Gate's "failed-job visibility (ops
 * console)" had nothing to render. This page is the render.
 *
 * The load-bearing rule: **a job that has never run shows red, not green.** An
 * ops console whose empty state is reassuring is worse than no console at all,
 * because it actively asserts something false. Same rule as "no evidence must
 * never read as safe" in NGO verification and "CLEAN must never mean nothing
 * was examined" in Week 8.
 *
 * Staleness comes from each job's declared cadence in lib/job-registry.ts, not
 * a fixed threshold: the quarterly FCRA report and a nightly drainer cannot
 * share one "too long since last run" number without the console either
 * screaming about the quarterly job eleven months a year or staying quiet about
 * a daily one for three months.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TONE: Record<"good" | "warn" | "bad", string> = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:ring-amber-900/40",
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
};

const TH =
  "px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500";
const TD = "px-3 py-2 text-sm text-gray-800 dark:text-gray-200";

function ago(from: Date, now: number): string {
  const mins = Math.floor((now - from.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Hours as a readable interval, without rounding a sub-day value away.
 *
 * The naive `Math.round(h / 24) || 1` rendered a 12-hour grace as "1d grace",
 * which is a false statement on a page whose entire job is being precise about
 * when something should have happened.
 */
function humanHours(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = hours / 24;
  return Number.isInteger(days) ? `${days}d` : `${days.toFixed(1)}d`;
}

function duration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function OpsPage() {
  const now = Date.now();

  // Two queries, not one per job: the latest run of each, and the latest
  // SUCCESS of each. They differ whenever a job is failing, and the distinction
  // is the whole point — health is measured from the last success, so a job
  // failing hourly cannot look punctual.
  const [latestRuns, latestSuccesses, failuresToday] = await Promise.all([
    prisma.jobRun.findMany({
      where: { job: { in: JOBS.map((j) => j.name) } },
      orderBy: { startedAt: "desc" },
      distinct: ["job"],
      select: {
        job: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        itemsProcessed: true,
        trigger: true,
        correlationId: true,
        errorName: true,
        errorMessage: true,
      },
    }),
    prisma.jobRun.findMany({
      where: { job: { in: JOBS.map((j) => j.name) }, status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      distinct: ["job"],
      select: { job: true, startedAt: true },
    }),
    prisma.jobRun.count({
      where: { status: "FAILED", startedAt: { gte: new Date(now - 24 * 3_600_000) } },
    }),
  ]);

  const lastByJob = new Map(latestRuns.map((r) => [r.job, r]));
  const successByJob = new Map(latestSuccesses.map((r) => [r.job, r.startedAt]));

  const rows = JOBS.map((def: JobDefinition) => {
    const last = lastByJob.get(def.name);
    const facts: LastRunFacts | null = last
      ? {
          status: last.status as LastRunFacts["status"],
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          lastSuccessAt: successByJob.get(def.name) ?? null,
        }
      : null;
    return { def, last, facts, health: jobHealth(def, facts, new Date(now)) };
  });

  const unhealthy = rows.filter((r) => r.health !== "ok");
  const neverRun = rows.filter((r) => r.health === "never_run");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Scheduled jobs</h1>
        </div>
        <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Every job the platform is supposed to run, and whether it actually did. A job that has
          never run is shown as a failure, not as healthy — silence is not success.
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          {rows.length} registered · {unhealthy.length} needing attention · {failuresToday} failed
          run{failuresToday === 1 ? "" : "s"} in the last 24h
        </p>
      </header>

      {neverRun.length > 0 && (
        <section className="rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
          <div className="flex items-center gap-2">
            <CircleSlash className="h-4 w-4 text-red-600 dark:text-red-400" />
            <h2 className="text-sm font-bold text-red-900 dark:text-red-300">
              {neverRun.length} job{neverRun.length === 1 ? " has" : "s have"} never run
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-red-800 dark:text-red-300/80">
            No ledger row exists for {neverRun.length === 1 ? "this job" : "these jobs"}. Either the
            schedule was never installed on the server, or it has never reached the route. Until one
            runs, nothing it is responsible for is happening — and nothing else on this page can
            tell you that.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {neverRun.map((r) => (
              <li
                key={r.def.name}
                className="rounded bg-red-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-900 dark:bg-red-900/40 dark:text-red-200"
              >
                {r.def.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className={TH}>Job</th>
              <th className={TH}>Health</th>
              <th className={TH}>Last run</th>
              <th className={TH}>Took</th>
              <th className={TH}>Items</th>
              <th className={TH}>Expected every</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ def, last, health }) => {
              const label = healthLabel(health as JobHealth);
              return (
                <tr
                  key={def.name}
                  className="border-b border-gray-100 align-top last:border-0 dark:border-gray-800/60"
                >
                  <td className={TD}>
                    <code className="font-mono text-[11px] font-semibold">{def.name}</code>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">{def.purpose}</p>
                    {last?.errorName && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {last.errorName}: {last.errorMessage}
                      </p>
                    )}
                    {last?.correlationId && (
                      <p className="mt-0.5 font-mono text-[10px] text-gray-400 dark:text-gray-600">
                        {last.correlationId}
                      </p>
                    )}
                  </td>
                  <td className={TD}>
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${TONE[label.tone]}`}
                    >
                      {label.text}
                    </span>
                  </td>
                  <td className={TD}>
                    {last ? (
                      <>
                        {ago(last.startedAt, now)}
                        <span className="ml-1 text-xs text-gray-500 dark:text-gray-500">
                          ({last.status.toLowerCase()}, {last.trigger.toLowerCase()})
                        </span>
                      </>
                    ) : (
                      <span className="font-semibold text-red-600 dark:text-red-400">never</span>
                    )}
                  </td>
                  <td className={TD}>{duration(last?.durationMs ?? null)}</td>
                  <td className={TD}>
                    {/* null is "the job did not say", which is not the same as
                        zero. A nightly drainer reporting 0 is healthy. */}
                    {last?.itemsProcessed ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className={TD}>
                    {humanHours(def.everyHours)}
                    <span className="ml-1 text-xs text-gray-500 dark:text-gray-500">
                      +{humanHours(def.graceHours)} grace
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">How these are scheduled</h2>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-gray-600 dark:text-gray-400">
          The cadences above are declared in <code>lib/job-registry.ts</code>, which also generates
          the server&apos;s crontab — so what is expected here and what actually runs come from one
          source. <code>vercel.json</code> still lists these nine schedules and fires none of them:
          the platform does not deploy to Vercel.
        </p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
          Detection and visibility only. Nothing here escalates, retries or pages anyone — a red row
          is surfaced to a human who is already looking, not pushed to one who is not. Same honesty
          note as <code>/admin/sla</code>.
        </p>
      </section>
    </div>
  );
}
