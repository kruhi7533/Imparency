import { NextRequest, NextResponse } from "next/server";
import { generateFcraQuarterlyReport } from "@/lib/fcra-quarterly";
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

  // Job lock: this runs quarterly, so a 5-minute window can never block a
  // legitimate scheduled run — it only absorbs a genuine duplicate invocation
  // that would otherwise re-send the admin quarterly report email (the DB
  // row itself is already upsert-safe, but the email send is not).
  const { success: notDuplicate } = await rateLimit("cron-job", "cron/fcra-quarterly-report", 1, 300);
  if (!notDuplicate) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Duplicate invocation within lock window" });
  }

  try {
    const report = await generateFcraQuarterlyReport();
    return NextResponse.json({ ok: true, quarter: report.quarter, totalNgos: report.totalNgos });
  } catch (err: any) {
    console.error("[cron/fcra-quarterly-report] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
