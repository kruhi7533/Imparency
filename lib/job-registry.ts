/**
 * The declared set of scheduled jobs, and how often each is supposed to run.
 *
 * ## Why this file exists
 *
 * Until now the only statement of the schedule was `vercel.json`, and **the
 * platform does not deploy to Vercel** — it runs on a real server on its own
 * domain. Those nine entries have never fired anything. So the schedule was
 * simultaneously the only documentation of intent and completely inert, which
 * is the worst of both: it looks authoritative and means nothing.
 *
 * Declaring the cadence in code makes two things possible that a cron file
 * cannot:
 *
 *  1. **Staleness is computable.** `/admin/ops` can say "this should have run
 *     within 24 hours and last succeeded 6 days ago" rather than just listing
 *     runs and leaving the arithmetic to a human who is not doing it.
 *  2. **The crontab is generated, not transcribed.** `renderCrontab()` below
 *     emits the real server's schedule from this same data, so the expectation
 *     and the thing actually running cannot drift.
 *
 * Pure data and pure functions: no database, no Prisma. The ledger lives in
 * lib/job-runner.ts.
 */

export interface JobDefinition {
  /** Registry key. Matches the route folder: app/api/cron/<name>. */
  name: string;
  /** What an admin should call it. */
  label: string;
  /** One line on what it does, for the ops console. */
  purpose: string;
  /** Cron expression, five fields. The crontab is generated from this. */
  schedule: string;
  /**
   * How often a healthy run should happen, in hours.
   *
   * Derived from `schedule` by hand rather than parsed: a cron parser is a
   * dependency and a source of subtle bugs, and these nine numbers change
   * about once a year.
   */
  everyHours: number;
  /**
   * Slack before a late job counts as overdue.
   *
   * Not a fixed threshold, because the jobs are not alike. A daily job silent
   * for 30 hours is a problem; the quarterly FCRA report silent for 30 hours
   * is simply not due. Fixing one number for both would either scream about
   * the quarterly job eleven months a year or stay quiet about a daily one for
   * three months — and an alert that fires on the healthy case trains people
   * to ignore the whole category, which is the reasoning already written down
   * for "a missing 12A is not a defect".
   */
  graceHours: number;
  /**
   * After this long, a run still marked RUNNING is stuck, not in flight.
   *
   * A process killed mid-run leaves its row RUNNING forever. Without a cutoff
   * that row would block every later run as "already in progress" — the
   * failure mode where a safety check becomes the outage.
   */
  maxRuntimeMinutes: number;
}

export const JOBS: JobDefinition[] = [
  {
    name: "fcra-expiry",
    label: "FCRA expiry sweep",
    purpose: "Flags FCRA certificates approaching or past expiry.",
    schedule: "0 2 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 15,
  },
  {
    name: "deliver-impact",
    label: "Impact delivery outbox",
    purpose: "Drains pending donor impact deliveries (email / in-app).",
    schedule: "0 3 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 20,
  },
  {
    name: "reminders",
    label: "Admin reminders",
    purpose: "Nudges overdue milestones and stale admin queues.",
    schedule: "30 3 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 15,
  },
  {
    name: "impact-digest",
    label: "Impact digest",
    purpose: "Builds digest-frequency donor updates.",
    schedule: "0 4 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 20,
  },
  {
    name: "crisis-notify",
    label: "Crisis notifications",
    purpose: "Notifies subscribers of active crisis events.",
    schedule: "0 5 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 15,
  },
  {
    name: "risk-sweep",
    label: "Risk sweep",
    purpose: "Platform-wide risk checks and alert generation.",
    schedule: "0 6 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 20,
  },
  {
    name: "risk-scores",
    label: "Risk score refresh",
    purpose: "Recomputes NGO and donor risk scores.",
    schedule: "30 6 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 30,
  },
  {
    name: "risk-dispatch",
    label: "Risk dispatch",
    purpose: "Queues and drains risk-driven follow-up actions.",
    schedule: "0 7 * * *",
    everyHours: 24,
    graceHours: 12,
    maxRuntimeMinutes: 20,
  },
  {
    name: "fcra-quarterly-report",
    label: "FCRA quarterly report",
    purpose: "Generates the quarterly FCRA compliance report.",
    // 01:00 on the 1st of Jan / Apr / Jul / Oct.
    schedule: "0 1 1 1,4,7,10 *",
    // ~92 days. Deliberately generous grace: being a day late on a quarterly
    // report is not an incident, and a false alarm here costs more than the
    // lateness does.
    everyHours: 24 * 92,
    graceHours: 24 * 7,
    maxRuntimeMinutes: 30,
  },
];

export function jobByName(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}

/** Every registered name, for validating a caller's job key. */
export const JOB_NAMES: string[] = JOBS.map((j) => j.name);

/**
 * How a job is doing, judged from its most recent run.
 *
 * `never_run` is its own state and must never be rendered as healthy. An ops
 * console whose empty state is green actively asserts something false — the
 * same rule as "no evidence must never read as safe" in NGO verification and
 * "CLEAN must never mean nothing was examined" in Week 8. On today's data
 * `deliver-impact` has to come out red.
 */
export type JobHealth = "never_run" | "ok" | "overdue" | "failing" | "stuck";

export interface LastRunFacts {
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  startedAt: Date;
  finishedAt: Date | null;
  /** Most recent SUCCEEDED run, which may be older than the last run. */
  lastSuccessAt: Date | null;
}

/**
 * Judge one job.
 *
 * Order matters here, unlike the Week 8 triage: these states are exclusive and
 * the most actionable one wins. A job that is both failing and overdue is
 * reported as failing, because the failure is the cause and the overdue-ness
 * is the symptom.
 */
export function jobHealth(
  def: JobDefinition,
  last: LastRunFacts | null,
  now: Date = new Date()
): JobHealth {
  if (!last) return "never_run";

  // A run still open past its own budget is stuck, not working.
  if (last.status === "RUNNING") {
    const openMs = now.getTime() - last.startedAt.getTime();
    return openMs > def.maxRuntimeMinutes * 60_000 ? "stuck" : "ok";
  }

  if (last.status === "FAILED") return "failing";

  // Measured from the last SUCCESS, never from the last attempt. A job
  // failing every hour would otherwise look punctual.
  if (!last.lastSuccessAt) return "failing";

  const sinceSuccessHours = (now.getTime() - last.lastSuccessAt.getTime()) / 3_600_000;
  return sinceSuccessHours > def.everyHours + def.graceHours ? "overdue" : "ok";
}

/** Reviewer-facing label and tone, mirroring verdictLabel in outcome-triage. */
export function healthLabel(health: JobHealth): { text: string; tone: "good" | "warn" | "bad" } {
  switch (health) {
    case "ok":
      return { text: "Healthy", tone: "good" };
    case "never_run":
      return { text: "Never run", tone: "bad" };
    case "failing":
      return { text: "Failing", tone: "bad" };
    case "stuck":
      return { text: "Stuck", tone: "bad" };
    case "overdue":
      return { text: "Overdue", tone: "warn" };
  }
}

/**
 * The real server's crontab, generated from the registry.
 *
 * Replaces `vercel.json`, which declares these same nine schedules and fires
 * none of them. Each line calls the route with the shared secret, exactly as
 * the handlers expect.
 *
 * `-f` makes curl exit non-zero on an HTTP error so cron's own mail/logging
 * notices; `-s -S` keeps it quiet except for errors.
 */
export function renderCrontab(baseUrl: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  const header = [
    "# ImpactBridge scheduled jobs — GENERATED from lib/job-registry.ts.",
    "# Do not hand-edit: regenerate instead, or the ops console's staleness",
    "# thresholds will disagree with what actually runs.",
    "#",
    "# Requires CRON_SECRET in the crontab environment.",
    "",
  ];
  const lines = JOBS.map(
    (j) =>
      `${j.schedule} curl -fsS -H "Authorization: Bearer $CRON_SECRET" ${origin}/api/cron/${j.name}`
  );
  return [...header, ...lines, ""].join("\n");
}
