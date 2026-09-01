import { NextRequest, NextResponse } from "next/server";
import { refreshAllNgoScores, refreshAllDonorScores } from "@/lib/risk-engine/store";
import { evaluateVerifiedNgos } from "@/lib/verification-reversal";
import { sweepUnbackedComplianceFlags } from "@/lib/compliance-evidence";
import { rateLimit } from "@/lib/rate-limiter";
import crypto from "crypto";

export const runtime = "nodejs";

/**
 * Recompute every entity risk score.
 *
 * This is the ONLY thing that keeps the Radar's ranking current in bulk, and it
 * lives on a schedule rather than on page load for the reason the platform
 * sweep already taught: scoring is maintenance, and maintenance done on the
 * request path is a tax every admin pays to look at a page. Individual scores
 * are also refreshed at their own edges (see refreshRiskScore) — this sweep is
 * the backstop that catches whatever those edges miss, plus the inputs that
 * change with no event at all, like an FCRA certificate quietly expiring.
 *
 * Scores are measurement only. Nothing here opens a case, raises an alert, or
 * notifies anyone; acting on a score is a separate decision that belongs to the
 * aggregator behind its own switch.
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

  // Job lock, matching the other cron routes: the sweep is idempotent, but a
  // duplicate invocation still costs a full pass over every NGO and donor.
  const { success: notDuplicate } = await rateLimit("cron-job", "cron/risk-scores", 1, 300);
  if (!notDuplicate) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Duplicate invocation within lock window" });
  }

  try {
    const ngos = await refreshAllNgoScores();
    const donors = await refreshAllDonorScores();

    // Catch approvals whose evidence failed before this sweep existed, or
    // failed without extraction re-running since. Costs no model calls — it
    // reads findings that are already stored.
    const reverification = await evaluateVerifiedNgos();

    // Retract compliance badges the platform cannot support. Runs every night
    // because a flag with nothing behind it is a false statement to donors, and
    // an unsupported claim should not wait for someone to notice it.
    const flags = await sweepUnbackedComplianceFlags();

    return NextResponse.json({ ok: true, ngos, donors, reverification, flags });
  } catch (err: any) {
    console.error("[cron/risk-scores] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
