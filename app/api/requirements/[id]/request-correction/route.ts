import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { requestCorrection } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse, readJson } from "@/lib/requirements/http";

/** Admin only: DONOR_REVIEW / PENDING_ADMIN_REVIEW → NEEDS_CORRECTION. Body: { note } (required). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    const updated = await requestCorrection(params.id, actor, body.note, request);
    return NextResponse.json({ requirement: serializeRequirement(updated) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/request-correction");
  }
}
