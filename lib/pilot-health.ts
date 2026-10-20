import prisma from "@/lib/prisma";
import { JOBS, jobHealth, type LastRunFacts } from "@/lib/job-registry";
import { loadInboxSources } from "@/lib/today-sources";
import { breachedItems, buildInboxItems } from "@/lib/today-inbox";

/**
 * Pilot health (roadmap row 15): "is the pilot OK right now?" on one screen,
 * from data the platform already records — no new telemetry store.
 *
 * The verdict is a pure function of the signals so it can be tested and argued
 * with. RED means a person must act now; AMBER means something is slipping;
 * GREEN means every signal is inside its bound — never "nothing was checked":
 * a signal that could not be read is reported as unknown and makes the verdict
 * AMBER at best.
 */

export type Level = "green" | "amber" | "red";

export interface PilotSignals {
  jobs: { failingOrStuck: number; overdueOrNever: number; total: number } | null;
  slaBreaches: number | null;
  openFinanceExceptions: number | null;
  unresolvedHighFraud: number | null;
  payments24h: { succeeded: number; failed: number } | null;
  lastWebhookAt: string | null;
}

export interface SignalVerdict {
  key: keyof PilotSignals;
  level: Level;
  text: string;
  href: string;
}

const MIN_ATTEMPTS_FOR_RATE = 5;
const FAILURE_RATE_RED = 0.2;

export function judgeSignals(s: PilotSignals): { level: Level; signals: SignalVerdict[] } {
  const out: SignalVerdict[] = [];
  const unknown = (key: keyof PilotSignals, what: string, href: string) => out.push({ key, level: "amber", text: `${what}: could not be read`, href });

  if (!s.jobs) unknown("jobs", "Scheduled jobs", "/admin/ops");
  else
    out.push({
      key: "jobs",
      level: s.jobs.failingOrStuck > 0 ? "red" : s.jobs.overdueOrNever > 0 ? "amber" : "green",
      text:
        s.jobs.failingOrStuck + s.jobs.overdueOrNever === 0
          ? `All ${s.jobs.total} scheduled jobs healthy`
          : `${s.jobs.failingOrStuck} failing or stuck, ${s.jobs.overdueOrNever} overdue or never run (of ${s.jobs.total})`,
      href: "/admin/ops",
    });

  if (s.slaBreaches === null) unknown("slaBreaches", "Response targets", "/admin/sla");
  else
    out.push({
      key: "slaBreaches",
      level: s.slaBreaches > 0 ? "amber" : "green",
      text: s.slaBreaches > 0 ? `${s.slaBreaches} item${s.slaBreaches === 1 ? "" : "s"} past response target` : "Every queue within target",
      href: "/admin/sla",
    });

  if (s.unresolvedHighFraud === null) unknown("unresolvedHighFraud", "Fraud alerts", "/admin/risk-compliance");
  else
    out.push({
      key: "unresolvedHighFraud",
      level: s.unresolvedHighFraud > 0 ? "red" : "green",
      text: s.unresolvedHighFraud > 0 ? `${s.unresolvedHighFraud} unresolved HIGH fraud alert${s.unresolvedHighFraud === 1 ? "" : "s"}` : "No unresolved HIGH fraud alerts",
      href: "/admin/risk-compliance",
    });

  if (s.openFinanceExceptions === null) unknown("openFinanceExceptions", "Finance exceptions", "/admin/finance");
  else
    out.push({
      key: "openFinanceExceptions",
      level: s.openFinanceExceptions > 0 ? "amber" : "green",
      text: s.openFinanceExceptions > 0 ? `${s.openFinanceExceptions} open finance exception${s.openFinanceExceptions === 1 ? "" : "s"}` : "Ledger reconciles — no open exceptions",
      href: "/admin/finance",
    });

  if (!s.payments24h) unknown("payments24h", "Payments", "/admin/finance");
  else {
    const attempts = s.payments24h.succeeded + s.payments24h.failed;
    const rate = attempts ? s.payments24h.failed / attempts : 0;
    out.push({
      key: "payments24h",
      level: attempts >= MIN_ATTEMPTS_FOR_RATE && rate > FAILURE_RATE_RED ? "red" : s.payments24h.failed > 0 ? "amber" : "green",
      text:
        attempts === 0
          ? "No donation attempts in the last 24 hours"
          : `${s.payments24h.succeeded} succeeded, ${s.payments24h.failed} failed in 24h (${Math.round(rate * 100)}% failed)`,
      href: "/admin/finance",
    });
  }

  out.push({
    key: "lastWebhookAt",
    level: "green",
    text: s.lastWebhookAt ? `Last payment webhook received ${new Date(s.lastWebhookAt).toLocaleString("en-IN")}` : "No payment webhook received yet",
    href: "/admin/finance",
  });

  const level: Level = out.some((o) => o.level === "red") ? "red" : out.some((o) => o.level === "amber") ? "amber" : "green";
  return { level, signals: out };
}

/** Each signal read independently: one failing query makes that signal "unknown", not the page a 500. */
export async function loadPilotSignals(now: Date = new Date()): Promise<PilotSignals> {
  const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      console.error("[pilot-health] signal failed:", err);
      return null;
    }
  };
  const since = new Date(now.getTime() - 24 * 3_600_000);

  const [jobs, slaBreaches, openFinanceExceptions, unresolvedHighFraud, payments24h, lastWebhookAt] = await Promise.all([
    safe(async () => {
      const names = JOBS.map((j) => j.name);
      const [latest, successes] = await Promise.all([
        prisma.jobRun.findMany({ where: { job: { in: names } }, orderBy: { startedAt: "desc" }, distinct: ["job"], select: { job: true, status: true, startedAt: true, finishedAt: true } }),
        prisma.jobRun.findMany({ where: { job: { in: names }, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, distinct: ["job"], select: { job: true, startedAt: true } }),
      ]);
      let failingOrStuck = 0;
      let overdueOrNever = 0;
      for (const def of JOBS) {
        const last = latest.find((r) => r.job === def.name);
        const facts: LastRunFacts | null = last
          ? { status: last.status as LastRunFacts["status"], startedAt: last.startedAt, finishedAt: last.finishedAt, lastSuccessAt: successes.find((r) => r.job === def.name)?.startedAt ?? null }
          : null;
        const h = jobHealth(def, facts, now);
        if (h === "failing" || h === "stuck") failingOrStuck++;
        else if (h === "overdue" || h === "never_run") overdueOrNever++;
      }
      return { failingOrStuck, overdueOrNever, total: JOBS.length };
    }),
    safe(async () => breachedItems(buildInboxItems(await loadInboxSources(prisma), now.getTime())).length),
    safe(() => prisma.financeException.count({ where: { status: "OPEN" } })),
    safe(() => prisma.fraudAlert.count({ where: { resolved: false, severity: "HIGH" } })),
    safe(async () => {
      const [succeeded, failed] = await Promise.all([
        prisma.donation.count({ where: { status: "SUCCESS", createdAt: { gte: since } } }),
        prisma.donation.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
      ]);
      return { succeeded, failed };
    }),
    safe(async () => (await prisma.webhookEvent.findFirst({ orderBy: { processedAt: "desc" }, select: { processedAt: true } }))?.processedAt.toISOString() ?? null),
  ]);

  return { jobs, slaBreaches, openFinanceExceptions, unresolvedHighFraud, payments24h, lastWebhookAt: lastWebhookAt ?? null };
}
