import { NextRequest, NextResponse } from "next/server";
import { enqueueFromScores, drainDispatches, DISPATCH_BUDGET } from "@/lib/risk-engine/dispatch";
import { rateLimit } from "@/lib/rate-limiter";
import crypto from "crypto";

export const runtime = "nodejs";
/**
 * A drain of DISPATCH_BUDGET investigations can run for several minutes — the
 * expensive end of this pipeline is throttled by a token ceiling, not by CPU.
 */
export const maxDuration = 800;

/**
 * The Radar's dispatch loop: decide, then do a bounded amount.
 *
 * Runs after the scoring sweep (cron/risk-scores) so it always routes on fresh
 * numbers. Two phases, in order:
 *
 *   1. enqueue — every current score is routed. HIGH NGOs queue for the fraud
 *      investigator; UNKNOWN NGOs queue for document extraction, because an
 *      investigation has nothing to read; everything else is recorded as an
 *      explicit MONITOR decision.
 *   2. drain — the top few queued items actually run, worst score first.
 *
 * The budget exists because the investigator's real-world throughput is about
 * one run per six minutes. Raising RISK_DISPATCH_MAX_PER_RUN is how you buy
 * more coverage once there is more capacity to buy it with.
 *
 * Nothing here suspends, rejects, or clears anyone. It decides where to look.
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

  // Job lock. Longer than the other cron routes' 300s because a drain can
  // legitimately run for minutes, and a second invocation landing mid-drain
  // would spend the budget twice.
  const { success: notDuplicate } = await rateLimit("cron-job", "cron/risk-dispatch", 1, 900);
  if (!notDuplicate) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Duplicate invocation within lock window" });
  }

  try {
    const queued = await enqueueFromScores();
    const drained = await drainDispatches();
    return NextResponse.json({ ok: true, budget: DISPATCH_BUDGET, queued, drained });
  } catch (err: any) {
    console.error("[cron/risk-dispatch] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
