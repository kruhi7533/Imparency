import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { requestResponseChanges } from "@/lib/requirements/opportunities";
import { errorResponse, readJson } from "@/lib/requirements/http";

/**
 * Owner or admin: PROPOSAL_SUBMITTED → CHANGES_REQUESTED on one NGO proposal.
 * Body: { note } (required, 10–4000 chars). The requirement stays NGO_RESPONSE.
 */
export async function POST(request: Request, { params }: { params: { id: string; responseId: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    const updated = await requestResponseChanges(params.id, actor, params.responseId, body.note);
    return NextResponse.json({
      response: { id: updated.id, status: updated.status, revisionRounds: updated.revisionRounds, version: updated.version },
    });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/responses/[responseId]/request-changes");
  }
}
