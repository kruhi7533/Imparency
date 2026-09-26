import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { selectResponse } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse, readJson } from "@/lib/requirements/http";

/** Owner/admin selects one NGO response: NGO_RESPONSE → SELECTED (single award). Body: { responseId } */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    const updated = await selectResponse(params.id, actor, body.responseId);
    return NextResponse.json({ requirement: serializeRequirement(updated) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/select");
  }
}
