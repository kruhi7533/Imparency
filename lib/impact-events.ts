import prisma from "@/lib/prisma";
import { ImpactEventType } from "@prisma/client";

/**
 * Impact event pipeline: emit → fan out to subscribers → outbox rows.
 *
 * Design invariants:
 * - Events are append-only facts. Deliveries are the outbox; the cron
 *   (/api/cron/deliver-impact) drains them with retries.
 * - Fan-out is idempotent: @@unique(eventId, donorId, channel) +
 *   skipDuplicates means re-emitting or crashing mid-fan-out never
 *   double-delivers.
 * - emit is best-effort for callers: an impact-pipeline failure must never
 *   break proof submission or admin approval. Failures log loudly.
 * - Scale: fan-out is one createMany per event (no per-subscriber writes),
 *   and the cron processes bounded batches so a viral project can't blow
 *   past serverless limits.
 */

export async function emitProjectImpactEvent(params: {
  projectId: string;
  milestoneId?: string | null;
  type: ImpactEventType;
  title: string;
  body: string;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const event = await prisma.projectImpactEvent.create({
      data: {
        projectId: params.projectId,
        milestoneId: params.milestoneId ?? null,
        type: params.type,
        title: params.title.slice(0, 200),
        body: params.body,
        payload: (params.payload as any) ?? undefined,
      },
    });

    // Fan out to active subscribers. Channels are stored per subscription;
    // one outbox row per (donor, channel).
    const subs = await prisma.impactSubscription.findMany({
      where: { projectId: params.projectId, active: true },
      select: { donorId: true, channels: true, frequency: true },
    });
    if (subs.length === 0) return;

    const rows = subs.flatMap((s) =>
      s.channels
        .filter((c): c is "IN_APP" | "EMAIL" => c === "IN_APP" || c === "EMAIL")
        .map((channel) => ({
          eventId: event.id,
          donorId: s.donorId,
          channel: channel as any,
        }))
    );

    await prisma.impactDelivery.createMany({ data: rows, skipDuplicates: true });
  } catch (err) {
    console.error(
      `[impact-events] FAILED to emit ${params.type} for project ${params.projectId}:`,
      err
    );
  }
}

/**
 * Auto-subscribe a donor to a project's impact feed. Called from the payment
 * webhook on first successful donation — donating IS the expression of
 * interest (opt-out model). Idempotent via the unique(donorId, projectId).
 */
export async function ensureImpactSubscription(donorId: string, projectId: string): Promise<void> {
  try {
    await prisma.impactSubscription.upsert({
      where: { donorId_projectId: { donorId, projectId } },
      update: {}, // never overwrite donor-chosen channels/frequency
      create: { donorId, projectId },
    });
  } catch (err) {
    console.error(`[impact-events] FAILED to subscribe donor ${donorId} to project ${projectId}:`, err);
  }
}
