import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendImpactUpdateEmail } from "@/lib/email";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50; // bounded — a viral project drains over several runs, never times out

/**
 * Outbox drainer for impact deliveries. Runs once daily (vercel.json) — a
 * Vercel Hobby-plan constraint (Hobby only allows daily cron jobs); the
 * original design intent was every 10 minutes for true INSTANT delivery.
 * Upgrade to Pro and tighten this schedule if near-real-time delivery matters.
 *
 * Guarantees:
 * - At-least-once delivery with capped retries; exhausted rows become FAILED
 *   (visible, queryable) instead of silently dropped.
 * - Row-level status updates mean a crash mid-batch redelivers at most the
 *   in-flight row, and IN_APP/EMAIL sends are safe to repeat.
 * - Only INSTANT-frequency subscriptions are drained here; digest rows are
 *   left PENDING for the (future) digest job.
 */
export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.CRON_SECRET;
  const isAuthorized =
    !!expected &&
    !!secret &&
    secret.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pending = await prisma.impactDelivery.findMany({
    where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    include: { event: true },
  });

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Batch-load donors + subscriptions (frequency check) — no N+1.
  const donorIds = Array.from(new Set(pending.map((d) => d.donorId)));
  const projectIds = Array.from(new Set(pending.map((d) => d.event.projectId)));
  const [donors, subs, projects] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: donorIds } },
      select: { id: true, name: true, email: true },
    }),
    prisma.impactSubscription.findMany({
      where: { donorId: { in: donorIds }, projectId: { in: projectIds } },
      select: { donorId: true, projectId: true, frequency: true, active: true },
    }),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, title: true },
    }),
  ]);
  const donorMap = new Map(donors.map((d) => [d.id, d]));
  const projectMap = new Map(projects.map((p) => [p.id, p.title]));
  const subMap = new Map(subs.map((s) => [`${s.donorId}:${s.projectId}`, s]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const delivery of pending) {
    const donor = donorMap.get(delivery.donorId);
    const sub = subMap.get(`${delivery.donorId}:${delivery.event.projectId}`);
    const projectTitle = projectMap.get(delivery.event.projectId) ?? "a project you supported";

    // Unsubscribed since fan-out → cancel, don't send.
    if (!donor || sub?.active === false) {
      await prisma.impactDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError: "Donor missing or unsubscribed" },
      });
      failed++;
      continue;
    }

    // Digest subscribers get their EMAILs batched by the digest job; IN_APP
    // rows always deliver immediately (the notification bell is its own digest).
    if (sub && sub.frequency !== "INSTANT" && delivery.channel === "EMAIL") {
      skipped++;
      continue;
    }

    try {
      if (delivery.channel === "IN_APP") {
        await prisma.notification.create({
          data: {
            userId: donor.id,
            type: "IMPACT_UPDATE",
            title: delivery.event.title,
            body: `${projectTitle}: ${delivery.event.body.slice(0, 300)}`,
          },
        });
      } else {
        const result = await sendImpactUpdateEmail(
          donor.email,
          donor.name,
          projectTitle,
          delivery.event.title,
          delivery.event.body
        );
        if (!result.success) throw new Error(result.error || "Email send failed");
      }

      await prisma.impactDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
      });
      sent++;
    } catch (err: any) {
      const attempts = delivery.attempts + 1;
      await prisma.impactDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          lastError: String(err?.message ?? err).slice(0, 500),
          ...(attempts >= MAX_ATTEMPTS ? { status: "FAILED" } : {}),
        },
      });
      failed++;
    }
  }

  return NextResponse.json({ ok: true, processed: pending.length, sent, failed, skipped });
}
