import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { loadNgoImpactReport } from "@/lib/ngo-impact-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ngo/impact-report — the caller's own organisation's impact report
 * draft (NGO-017/NGO-018). No id parameter: the organisation comes from the
 * session, so there is nothing to tamper with. Owners and team members may read.
 */
export async function GET() {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  try {
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership", code: "NO_NGO_MEMBERSHIP" }, { status: 403 });
    const report = await loadNgoImpactReport(actor.ngoId);
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[api/ngo/impact-report] GET error:", error);
    return NextResponse.json({ error: "Failed to build the impact report.", code: "REPORT_FAILED" }, { status: 500 });
  }
}
