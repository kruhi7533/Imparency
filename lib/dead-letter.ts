import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { JOBS } from "@/lib/job-registry";

/**
 * Operator dead-letter queue (ADM-018 / NEG-012).
 *
 * Work that failed for good lands here with ids only, the error and the
 * attempt count:
 *   JOB_RUN               a scheduled job run that threw (lib/job-runner.ts)
 *   IMPACT_DELIVERY       an impact update that exhausted its retries
 *                         (app/api/cron/deliver-impact)
 *   NOTIFICATION_DELIVERY a donor notification that FAILED on a channel
 *                         (lib/notification-dispatch.ts)
 *
 * An admin can inspect, replay ONCE, or dismiss. Replay is a compare-and-swap
 * OPEN -> REPLAYING, so a double click, two admins, or a retried request run
 * the work exactly once; the second gets 409. Each replay handler is itself
 * idempotent against its source (a delivery already SENT is not re-sent).
 */

export type DeadLetterKind = "JOB_RUN" | "IMPACT_DELIVERY" | "NOTIFICATION_DELIVERY";
export const DEAD_LETTER_KINDS: DeadLetterKind[] = ["JOB_RUN", "IMPACT_DELIVERY", "NOTIFICATION_DELIVERY"];
export type DeadLetterStatus = "OPEN" | "REPLAYING" | "REPLAYED" | "REPLAY_FAILED" | "DISMISSED";
export const DEAD_LETTER_STATUSES: DeadLetterStatus[] = ["OPEN", "REPLAYING", "REPLAYED", "REPLAY_FAILED", "DISMISSED"];

/** Record a failure. Never throws — the DLQ is secondary to the work itself. */
export async function recordDeadLetter(params: {
  kind: DeadLetterKind;
  sourceId: string;
  refs: Record<string, string | number | null>;
  errorMessage: string | null;
  attempts: number;
}): Promise<void> {
  try {
    const errorMessage = params.errorMessage ? params.errorMessage.slice(0, 500) : null;
    await prisma.deadLetter.upsert({
      where: { kind_sourceId: { kind: params.kind, sourceId: params.sourceId } },
      create: { kind: params.kind, sourceId: params.sourceId, refs: params.refs, errorMessage, attempts: params.attempts },
      update: { errorMessage, attempts: params.attempts },
    });
  } catch (err) {
    captureError(err, { scope: "lib/dead-letter", operation: "record", extra: { kind: params.kind } });
  }
}

export interface ReplayContext {
  adminId: string;
  /** Origin of the incoming admin request, for calling a cron route like "Run now" does. */
  origin: string;
}

export type ReplayOutcome =
  | { ok: true; status: "REPLAYED"; result: Record<string, unknown> }
  | { ok: false; status: "REPLAY_FAILED"; result: Record<string, unknown> }
  | { ok: false; conflict: true; currentStatus: string | null };

type Handler = (refs: Record<string, any>, sourceId: string, ctx: ReplayContext) => Promise<Record<string, unknown>>;

/** Re-run a job through its real cron route, exactly like /admin/ops "Run now". */
async function replayJob(refs: Record<string, any>, _sourceId: string, ctx: ReplayContext) {
  const def = JOBS.find((j) => j.name === refs.job);
  if (!def) throw new Error("Unknown job.");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not configured on this server.");
  const res = await fetch(`${ctx.origin}/api/cron/${def.name}`, {
    headers: { authorization: `Bearer ${secret}`, "x-job-trigger": "MANUAL" },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Job returned HTTP ${res.status}`);
  return { job: def.name, httpStatus: res.status, skipped: !!body?.skipped };
}

async function replayImpactDelivery(_refs: Record<string, any>, sourceId: string) {
  const delivery = await prisma.impactDelivery.findUnique({ where: { id: sourceId }, include: { event: true } });
  if (!delivery) throw new Error("Delivery no longer exists.");
  if (delivery.status === "SENT") return { alreadyDelivered: true };
  const donor = await prisma.user.findUnique({ where: { id: delivery.donorId }, select: { id: true, name: true, email: true } });
  if (!donor) throw new Error("Donor no longer exists.");
  const project = await prisma.project.findUnique({ where: { id: delivery.event.projectId }, select: { title: true } });
  const projectTitle = project?.title ?? "a project you supported";

  if (delivery.channel === "IN_APP") {
    await prisma.notification.create({
      data: { userId: donor.id, type: "IMPACT_UPDATE", title: delivery.event.title, body: `${projectTitle}: ${delivery.event.body.slice(0, 300)}` },
    });
  } else {
    const { sendImpactUpdateEmail } = await import("@/lib/email");
    const result = await sendImpactUpdateEmail(donor.email, donor.name, projectTitle, delivery.event.title, delivery.event.body);
    if (!result.success) throw new Error((result as any).error || "Email send failed");
  }
  // Compare-and-swap so a concurrent drainer cannot double-count.
  await prisma.impactDelivery.updateMany({
    where: { id: sourceId, status: { not: "SENT" } },
    data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
  });
  return { delivered: true, channel: delivery.channel };
}

async function replayNotificationDelivery(_refs: Record<string, any>, sourceId: string) {
  const { retryDeliveryLog } = await import("@/lib/notification-dispatch");
  const result = await retryDeliveryLog(sourceId);
  if (result.status !== "SENT") throw new Error(`Retry ${result.status}${result.reason ? `: ${result.reason}` : ""}`);
  return { channel: result.channel, attempt: result.attempt, status: result.status };
}

export const REPLAY_HANDLERS: Record<DeadLetterKind, Handler> = {
  JOB_RUN: replayJob,
  IMPACT_DELIVERY: replayImpactDelivery,
  NOTIFICATION_DELIVERY: replayNotificationDelivery,
};

export async function replayDeadLetter(
  id: string,
  ctx: ReplayContext,
  handlers: Record<DeadLetterKind, Handler> = REPLAY_HANDLERS
): Promise<ReplayOutcome> {
  const claimed = await prisma.deadLetter.updateMany({
    where: { id, status: "OPEN" },
    data: { status: "REPLAYING", replayedById: ctx.adminId, replayedAt: new Date() },
  });
  if (claimed.count !== 1) {
    const current = await prisma.deadLetter.findUnique({ where: { id }, select: { status: true } });
    return { ok: false, conflict: true, currentStatus: current?.status ?? null };
  }
  const row = await prisma.deadLetter.findUnique({ where: { id } });
  const handler = row ? handlers[row.kind as DeadLetterKind] : undefined;
  try {
    if (!row || !handler) throw new Error("Unknown dead-letter kind.");
    const result = await handler((row.refs as Record<string, any>) ?? {}, row.sourceId, ctx);
    await prisma.deadLetter.update({ where: { id }, data: { status: "REPLAYED", replayResult: result as any } });
    return { ok: true, status: "REPLAYED", result };
  } catch (err) {
    const result = { error: (err as Error)?.message?.slice(0, 300) ?? "Replay failed" };
    await prisma.deadLetter.update({ where: { id }, data: { status: "REPLAY_FAILED", replayResult: result } });
    return { ok: false, status: "REPLAY_FAILED", result };
  }
}

export async function dismissDeadLetter(id: string, adminId: string): Promise<{ ok: boolean; currentStatus: string | null }> {
  const res = await prisma.deadLetter.updateMany({
    where: { id, status: { in: ["OPEN", "REPLAY_FAILED"] } },
    data: { status: "DISMISSED", dismissedAt: new Date(), dismissedById: adminId },
  });
  if (res.count === 1) return { ok: true, currentStatus: "DISMISSED" };
  const current = await prisma.deadLetter.findUnique({ where: { id }, select: { status: true } });
  return { ok: false, currentStatus: current?.status ?? null };
}

/** The source row, for the inspect view. Ids and statuses only. */
export async function deadLetterSource(kind: string, sourceId: string): Promise<Record<string, unknown> | null> {
  try {
    if (kind === "JOB_RUN") {
      return await prisma.jobRun.findUnique({
        where: { id: sourceId },
        select: { id: true, job: true, status: true, startedAt: true, finishedAt: true, durationMs: true, trigger: true, correlationId: true, errorName: true, errorMessage: true },
      });
    }
    if (kind === "IMPACT_DELIVERY") {
      return await prisma.impactDelivery.findUnique({
        where: { id: sourceId },
        select: { id: true, eventId: true, donorId: true, channel: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
      });
    }
    if (kind === "NOTIFICATION_DELIVERY") {
      return await prisma.notificationDeliveryLog.findUnique({
        where: { id: sourceId },
        select: { id: true, userId: true, eventKey: true, topic: true, channel: true, status: true, reason: true, attempt: true, createdAt: true },
      });
    }
  } catch {
    return null;
  }
  return null;
}
