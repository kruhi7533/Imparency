import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { reEngage } from "@/lib/re-engagement";

/**
 * POST /api/engagement/re-engage { reportId } — the signed-in donor asks for
 * their next-step suggestion on one of their own impact reports.
 *
 * The logic lives in lib/re-engagement.ts, shared with the daily cron
 * (/api/cron/re-engagement) that replaced the webhook's 48-hour setTimeout.
 * The old internal-secret path existed only for that timer and is gone; this
 * route is donor-session only. Idempotent per report: a repeat returns the
 * existing event and sends no second email.
 */
export async function POST(request: Request) {
  const { authorized, session, response } = await verifySessionRole("DONOR");
  if (!authorized) return response!;

  const body = await request.json().catch(() => ({}));
  const reportId = typeof body?.reportId === "string" ? body.reportId : "";
  if (!reportId) return NextResponse.json({ error: "reportId is required" }, { status: 400 });

  try {
    const result = await reEngage({ reportId, donorId: session!.user.id });
    if (result.status === "not_found") return NextResponse.json({ error: "Report not found" }, { status: 404 });
    if (result.status === "opted_out") return NextResponse.json({ success: true, skipped: "opted_out" });
    if (result.status === "exists") return NextResponse.json({ success: true, eventId: result.eventId, existing: true });
    return NextResponse.json({ success: true, path: result.path, eventId: result.eventId });
  } catch (error) {
    console.error("Error running re-engagement POST API:", error);
    return NextResponse.json({ error: "Failed to trigger re-engagement." }, { status: 500 });
  }
}
