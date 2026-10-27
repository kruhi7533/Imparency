import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { confirmExtractionFlag } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse, readJson } from "@/lib/requirements/http";

/**
 * Owner (while editable) or admin (at review) confirms a blocking extraction
 * warning — budget conflict, suspected prompt injection. Body: { flagId, note }.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    const updated = await confirmExtractionFlag(params.id, actor, body.flagId, body.note);
    return NextResponse.json({ requirement: serializeRequirement(updated, { includeRawText: true }) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/confirm-flag");
  }
}
