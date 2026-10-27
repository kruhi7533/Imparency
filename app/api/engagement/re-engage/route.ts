import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { reEngage } from "@/lib/re-engagement";
import { isRenewalKind, requestRenewal } from "@/lib/renewal-requests";

/**
 * POST /api/engagement/re-engage { reportId, kind?, message?, proposedAmount? }
 *
 * Two kinds of report id are accepted:
 *
 *  1. A stored contract impact report (ContractImpactReport, NGO-017). The
 *     donor acts on it: kind RENEWAL (default) or NEXT_OPPORTUNITY creates a
 *     RenewalRequest the NGO sees and answers (lib/renewal-requests.ts).
 *     Idempotent per (report, kind).
 *  2. A per-donation ImpactReport (legacy). The signed-in donor asks for their
 *     next-step suggestion; the logic lives in lib/re-engagement.ts, shared
 *     with the daily cron. Idempotent per report.
 *
 * Donor-session only. Any id that is not the caller's report is 404.
 */
export async function POST(request: Request) {
  const { authorized, session, response } = await verifySessionRole("DONOR");
  if (!authorized) return response!;

  const body = await request.json().catch(() => ({}));
  const reportId = typeof body?.reportId === "string" ? body.reportId : "";
  if (!reportId) return NextResponse.json({ error: "reportId is required" }, { status: 400 });

  try {
    const stored = await prisma.contractImpactReport.findUnique({ where: { id: reportId }, select: { id: true } });
    if (stored) {
      const kind = body?.kind === undefined ? "RENEWAL" : body.kind;
      if (!isRenewalKind(kind)) return NextResponse.json({ error: "kind must be RENEWAL or NEXT_OPPORTUNITY" }, { status: 400 });
      const r = await requestRenewal({ reportId, userId: session!.user.id, kind, message: body?.message, proposedAmount: body?.proposedAmount });
      switch (r.status) {
        case "not_found":
          return NextResponse.json({ error: "Report not found" }, { status: 404 });
        case "forbidden":
          return NextResponse.json({ error: r.error }, { status: 403 });
        case "not_published":
          return NextResponse.json({ error: "This report has not been published yet." }, { status: 409 });
        case "invalid":
          return NextResponse.json({ error: r.error }, { status: 400 });
        case "exists":
          return NextResponse.json({ success: true, request: r.request, existing: true });
        case "created":
          return NextResponse.json({ success: true, request: r.request }, { status: 201 });
      }
    }

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
