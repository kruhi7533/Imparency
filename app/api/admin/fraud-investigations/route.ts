import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import { logAdminAction } from "@/lib/admin-log";
import { investigate } from "@/lib/fraud-investigator/run";
import { resolveNgoId } from "@/lib/fraud-investigator/resolve-ngo";
import { INVESTIGATOR_ENABLED } from "@/lib/fraud-investigator/config";

export const runtime = "nodejs";

/**
 * ADMIN-only. Manually start an investigation — for an alert that didn't
 * clear the automatic HIGH-severity bar in lib/fraud-investigator/trigger.ts,
 * or to re-run one.
 *
 * Runs synchronously (up to WALL_CLOCK_MS) and returns the result: this is a
 * deliberate choice, not fire-and-forget, because an admin who clicked
 * "Investigate" is waiting for an answer, not a queue position.
 */
export async function POST(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  // Each run is several sequential model calls — rate-limited like every other
  // AI route in this console.
  const rl = await checkRateLimit(request, "admin/fraud-investigations", 10, 60);
  if (rl.isBlocked) return rl.response!;

  if (!INVESTIGATOR_ENABLED) {
    return NextResponse.json(
      { error: "The fraud investigator is disabled (INVESTIGATOR_ENABLED is not 'true')." },
      { status: 409 }
    );
  }

  try {
    const body = await request.json();
    const rawId = typeof body?.ngoId === "string" ? body.ngoId : null;
    const alertId = typeof body?.alertId === "string" ? body.alertId : null;
    if (!rawId) return NextResponse.json({ error: "ngoId is required" }, { status: 400 });

    // The Risk & Compliance table sends the alert's entityId, which for some
    // alert types is a milestone or project id despite entityType being "NGO".
    const ngoId = await resolveNgoId(rawId);
    if (!ngoId) {
      return NextResponse.json(
        { error: "Could not resolve this alert to an NGO — its entityId does not match any NGO, milestone, or project." },
        { status: 400 }
      );
    }

    const result = await investigate(ngoId, alertId, `manual:${auth.session.user.id}`);

    await logAdminAction({
      adminId: auth.session.user.id,
      action: "NGO_FLAGGED_FOR_RISK",
      entityType: "NGO",
      entityId: ngoId,
      note: result.summary,
      metadata: {
        investigationId: result.investigationId,
        status: result.status,
        riskLevel: result.riskLevel,
        riskReviewId: result.riskReviewId,
        stepsUsed: result.stepsUsed,
        costPaise: result.costPaise,
      },
      request,
    });

    return NextResponse.json({ result });
  } catch (err: any) {
    console.error("[admin/fraud-investigations] error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
