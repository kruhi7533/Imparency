import { NextResponse } from "next/server";
import crypto from "crypto";
import { runJob } from "@/lib/job-runner";
import { findDueReports, reEngage } from "@/lib/re-engagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily: re-engage donors whose impact report went out 48h+ ago. Replaces the
 * 48-hour setTimeout that used to live in the payment webhook, which never
 * fired on serverless. Safe to re-run: reEngage() is idempotent per report and
 * at most once per donor per cooldown window (lib/re-engagement.ts).
 */
export async function GET(req: Request) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.CRON_SECRET;
  const isAuthorized =
    !!expected &&
    !!secret &&
    secret.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  if (!isAuthorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outcome = await runJob("re-engagement", { req }, async (job) => {
    const due = await findDueReports(new Date());
    const counts = { created: 0, exists: 0, skipped: 0, failed: 0 };
    const seenDonors = new Set<string>();
    for (const r of due) {
      // One nudge per donor per run, even when several reports are due.
      if (seenDonors.has(r.donorId)) {
        counts.skipped++;
        continue;
      }
      seenDonors.add(r.donorId);
      try {
        const res = await reEngage({ reportId: r.id, donorId: r.donorId });
        if (res.status === "created") counts.created++;
        else if (res.status === "exists") counts.exists++;
        else counts.skipped++;
      } catch (err) {
        counts.failed++;
        console.error("[cron/re-engagement] report", r.id, err);
      }
    }
    job.recordItems(counts.created);
    return NextResponse.json({ ok: true, due: due.length, ...counts });
  });
  if (outcome.skipped) return NextResponse.json({ ok: true, skipped: true, reason: outcome.reason });
  return outcome.value;
}
