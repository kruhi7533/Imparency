import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { withdrawRequirement } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse } from "@/lib/requirements/http";

/** Owner only: withdraw a requirement before a proposal is selected. Body: { reason }. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await request.json().catch(() => ({}));
    const updated = await withdrawRequirement(params.id, actor, body?.reason);
    return NextResponse.json({ requirement: serializeRequirement(updated) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/withdraw");
  }
}
