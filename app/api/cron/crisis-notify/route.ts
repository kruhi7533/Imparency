import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { sendCrisisAlertEmail } from "@/lib/email";
import { sendPushNotification } from "@/lib/notification";
import { rateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 200; // bounded — a large fan-out drains over several runs, never times out

/**
 * Outbox drainer for crisis alert notifications. Same shape as
 * /api/cron/deliver-impact: at-least-once delivery, capped retries, exhausted
 * rows flip to FAILED (visible, queryable) instead of silently dropping.
 *
 * Runs once daily (vercel.json) — a Vercel Hobby-plan constraint (Hobby only
 * allows daily cron jobs), same trade-off already accepted for deliver-impact.
 * The real design intent is near-real-time delivery for a genuine emergency;
 * upgrade to Pro and tighten this schedule if that gap matters in practice.
 */
export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.CRON_SECRET;
  const isAuthorized =
    !!expected && !!secret && secret.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success: notDuplicate } = await rateLimit("cron-job", "cron/crisis-notify", 1, 240);
  if (!notDuplicate) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Duplicate invocation within lock window" });
  }

  const pending = await prisma.crisisNotificationDelivery.findMany({
    where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  if (pending.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  const donorIds = Array.from(new Set(pending.map((d) => d.donorId)));
  const crisisEventIds = Array.from(new Set(pending.map((d) => d.crisisEventId)));
  const [donors, events] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: donorIds } }, select: { id: true, name: true, email: true, crisisAlertsOptOut: true } }),
    prisma.crisisEvent.findMany({
      where: { id: { in: crisisEventIds } },
      select: { id: true, title: true, slug: true, disasterType: true, severity: true, affectedLocation: true, description: true, coverImage: true },
    }),
  ]);
  const donorMap = new Map(donors.map((d) => [d.id, d]));
  const eventMap = new Map(events.map((e) => [e.id, e]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const delivery of pending) {
    const donor = donorMap.get(delivery.donorId);
    const event = eventMap.get(delivery.crisisEventId);

    if (!donor || !event) {
      await prisma.crisisNotificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError: "Donor or crisis event no longer exists" },
      });
      failed++;
      continue;
    }

    // A donor may opt out between fan-out and drain — honor it at send time too.
    if (donor.crisisAlertsOptOut) {
      await prisma.crisisNotificationDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", lastError: "Donor opted out" } });
      skipped++;
      continue;
    }

    try {
      if (delivery.channel === "IN_APP") {
        // Writes the Notification row (feeds the existing bell) and attempts
        // FCM push in one call.
        await sendPushNotification(
          donor.id,
          `Emergency: ${event.title}`,
          `${event.disasterType.replace("_", " ")} · ${event.severity} severity · ${event.affectedLocation}`,
          { crisisSlug: event.slug }
        );
      } else {
        const result = await sendCrisisAlertEmail(donor.email, donor.name, event);
        if (!result.success) throw new Error(result.error || "Email send failed");
      }

      await prisma.crisisNotificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
      });
      sent++;
    } catch (err: any) {
      const attempts = delivery.attempts + 1;
      await prisma.crisisNotificationDelivery.update({
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
