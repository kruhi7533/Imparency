import { NextRequest, NextResponse } from "next/server";
import { runAllAdminReminders } from "@/lib/reminders";
import { rateLimit } from "@/lib/rate-limiter";
import crypto from "crypto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
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

  // Job lock: this runs daily, so a 5-minute window can never block a
  // legitimate scheduled run — it only absorbs a genuine duplicate
  // invocation (e.g. a Vercel retry) that would otherwise double-send
  // every admin/NGO reminder email in this batch.
  const { success: notDuplicate } = await rateLimit("cron-job", "cron/reminders", 1, 300);
  if (!notDuplicate) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Duplicate invocation within lock window" });
  }

  try {
    const results = await runAllAdminReminders();
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[cron/reminders] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
