import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { reviewShortlist } from "@/lib/requirements/workflow";
import { errorResponse, readJson } from "@/lib/requirements/http";

/**
 * ADM-006 — admin approves, rejects and orders the shortlist before any NGO is
 * invited. Body: { gapReportId, order: matchId[], rejected?: [{ matchId, reason }], note? }.
 * Audited in RequirementAuditLog (SHORTLIST_ADMIN_APPROVED) and AdminActionLog
 * (GAP_REPORT_APPROVED, ids only) by reviewShortlist().
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    return NextResponse.json(await reviewShortlist(params.id, actor, body, request));
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/shortlist");
  }
}
