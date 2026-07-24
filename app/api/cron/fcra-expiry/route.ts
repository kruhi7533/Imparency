import { NextRequest, NextResponse } from "next/server";
import { runFcraExpiryMaintenance } from "@/lib/fcra-reminders";
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
  // invocation that would otherwise double-send FCRA expiry reminder emails.
  const { success: notDuplicate } = await rateLimit("cron-job", "cron/fcra-expiry", 1, 300);
  if (!notDuplicate) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Duplicate invocation within lock window" });
  }

  try {
    const results = await runFcraExpiryMaintenance();
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[cron/fcra-expiry] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
