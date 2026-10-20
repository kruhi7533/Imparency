import prisma from "@/lib/prisma";
import { loadInboxSources } from "@/lib/today-sources";
import { breachesByQueue, buildInboxItems } from "@/lib/today-inbox";

/**
 * SLA escalation (roadmap row 9, "blocked/SLA queue"): once a day, if any queue
 * is past its response target, every admin gets ONE in-app notification
 * summarising it. /admin/sla used to be visibility only; a breach reached only
 * the admin who happened to be looking.
 *
 * - Same computation as /admin/sla (buildInboxItems → breachesByQueue), so the
 *   digest and the page cannot disagree.
 * - Idempotent per admin per day: a re-run (cron retry, manual "Run now")
 *   sends nothing twice.
 * - Queue names and counts only — no organisation names, no people.
 * - Nothing breached → nothing sent. A daily "all clear" trains people to
 *   ignore the notification.
 */

export const SLA_DIGEST_TYPE = "SLA_BREACH_DIGEST";

export function digestText(rows: { queue: string; count: number; worst: number }[]) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const lines = rows.slice(0, 6).map((r) => {
    return `${r.queue}: ${r.count} past target (worst ${r.worst} day${r.worst === 1 ? "" : "s"} over)`;
  });
  return {
    title: `${total} item${total === 1 ? " is" : "s are"} past the response target`,
    body: `${lines.join("; ")}${rows.length > 6 ? `; and ${rows.length - 6} more queues` : ""}. Open /admin/sla.`,
  };
}

export async function runSlaEscalation(now: Date = new Date()) {
  const rows = breachesByQueue(buildInboxItems(await loadInboxSources(prisma), now.getTime()));
  if (rows.length === 0) return { breachedQueues: 0, notified: 0 };

  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const [admins, already] = await Promise.all([
    prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
    prisma.notification.findMany({ where: { type: SLA_DIGEST_TYPE, createdAt: { gte: dayStart } }, select: { userId: true } }),
  ]);
  const done = new Set(already.map((n) => n.userId));
  const due = admins.filter((a) => !done.has(a.id));
  if (due.length > 0) {
    const { title, body } = digestText(rows);
    await prisma.notification.createMany({ data: due.map((a) => ({ userId: a.id, type: SLA_DIGEST_TYPE, title, body })) });
  }
  return { breachedQueues: rows.length, notified: due.length };
}
