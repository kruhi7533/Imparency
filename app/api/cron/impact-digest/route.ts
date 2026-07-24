import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendImpactUpdateEmail } from "@/lib/email";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;
const BATCH_DONORS = 25; // bounded per run

/**
 * Digest drainer — runs daily. Groups PENDING EMAIL deliveries of digest-
 * frequency subscribers into one email per donor. WEEKLY_DIGEST donors are
 * only flushed on Mondays. IN_APP digest rows are sent individually (the
 * notification bell is inherently a digest).
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

  const isMonday = new Date().getDay() === 1;

  // Digest subscriptions whose donors have pending email deliveries
  const digestSubs = await prisma.impactSubscription.findMany({
    where: {
      active: true,
      frequency: isMonday ? { in: ["DAILY_DIGEST", "WEEKLY_DIGEST"] } : "DAILY_DIGEST",
    },
    select: { donorId: true, projectId: true },
  });
  if (digestSubs.length === 0) return NextResponse.json({ ok: true, donors: 0 });

  const subKey = new Set(digestSubs.map((s) => `${s.donorId}:${s.projectId}`));
  const donorIds = Array.from(new Set(digestSubs.map((s) => s.donorId))).slice(0, BATCH_DONORS);

  const pending = await prisma.impactDelivery.findMany({
    where: {
      status: "PENDING",
      attempts: { lt: MAX_ATTEMPTS },
      channel: "EMAIL",
      donorId: { in: donorIds },
    },
    include: { event: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  // Only rows whose (donor, project) pair is actually on a digest subscription
  const rows = pending.filter((d) => subKey.has(`${d.donorId}:${d.event.projectId}`));
  if (rows.length === 0) return NextResponse.json({ ok: true, donors: 0, digested: 0 });

  const byDonor = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byDonor.get(r.donorId) ?? [];
    list.push(r);
    byDonor.set(r.donorId, list);
  }

  const projectIds = Array.from(new Set(rows.map((r) => r.event.projectId)));
  const [donors, projects] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: Array.from(byDonor.keys()) } }, select: { id: true, name: true, email: true } }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, title: true } }),
  ]);
  const donorMap = new Map(donors.map((d) => [d.id, d]));
  const projectMap = new Map(projects.map((p) => [p.id, p.title]));

  let sentDonors = 0;
  let digested = 0;

  for (const [donorId, deliveries] of Array.from(byDonor.entries())) {
    const donor = donorMap.get(donorId);
    if (!donor) continue;

    const lines = deliveries.map((d) => {
      const title = projectMap.get(d.event.projectId) ?? "a project you supported";
      return `• [${title}] ${d.event.title}\n  ${d.event.body}`;
    });

    try {
      const result = await sendImpactUpdateEmail(
        donor.email,
        donor.name,
        `${deliveries.length} update${deliveries.length === 1 ? "" : "s"} from your projects`,
        "Your impact digest",
        lines.join("\n\n")
      );
      if (!result.success) throw new Error(result.error || "Email send failed");

      await prisma.impactDelivery.updateMany({
        where: { id: { in: deliveries.map((d) => d.id) } },
        data: { status: "SENT", sentAt: new Date() },
      });
      sentDonors++;
      digested += deliveries.length;
    } catch (err: any) {
      // Increment attempts on the whole group; exhausted rows flip to FAILED next runs
      await prisma.impactDelivery.updateMany({
        where: { id: { in: deliveries.map((d) => d.id) } },
        data: { attempts: { increment: 1 }, lastError: String(err?.message ?? err).slice(0, 500) },
      });
      await prisma.impactDelivery.updateMany({
        where: { id: { in: deliveries.map((d) => d.id) }, attempts: { gte: MAX_ATTEMPTS } },
        data: { status: "FAILED" },
      });
    }
  }

  return NextResponse.json({ ok: true, donors: sentDonors, digested });
}
