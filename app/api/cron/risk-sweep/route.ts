import { NextRequest, NextResponse } from "next/server";
import { checkGeneralPlatformAlerts } from "@/lib/risk-agent";
import { rateLimit } from "@/lib/rate-limiter";
import crypto from "crypto";

export const runtime = "nodejs";

/**
 * Platform-wide risk sweep: opens alerts for milestones long past their
 * deadline with no proof, and for funded campaigns that have gone quiet.
 *
 * This used to run inline on every load of `app/admin/risk-compliance`, where
 * it was awaited *before* the page fetched any of its own data — so an admin
 * waited for a full scan of milestones and projects before seeing anything.
 * Measured, it was 466ms of a ~624ms page: three quarters of the wait was
 * maintenance work rather than the content the admin came for.
 *
 * It is maintenance, so it belongs on a schedule. Alerts it raises now appear
 * on the next sweep instead of the next page load — an acceptable trade for a
 * check whose thresholds are already 30 and 60 days.
 */
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

  // Job lock: the sweep is idempotent (it skips anything already alerted), but
  // a duplicate invocation still costs a full scan and can race the dedupe
  // check, so absorb retries the same way the other cron routes do.
  const { success: notDuplicate } = await rateLimit("cron-job", "cron/risk-sweep", 1, 300);
  if (!notDuplicate) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Duplicate invocation within lock window" });
  }

  try {
    await checkGeneralPlatformAlerts();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[cron/risk-sweep] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
