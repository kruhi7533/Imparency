import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { approveRequirement } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse, readJson } from "@/lib/requirements/http";

/** Admin only: PENDING_ADMIN_REVIEW → VALIDATED (fields become ADMIN_VERIFIED). Body: { note? } */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    const updated = await approveRequirement(params.id, actor, body.note, request);
    return NextResponse.json({ requirement: serializeRequirement(updated) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/admin-approve");
  }
}
