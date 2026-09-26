import { NextResponse } from "next/server";
import { requireActor, loadRequirementForActor } from "@/lib/requirements/access";
import { listResponses } from "@/lib/requirements/queries";
import { errorResponse } from "@/lib/requirements/http";

/** NGO responses to this requirement's opportunity brief (owner/admin). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    await loadRequirementForActor(params.id, actor);
    return NextResponse.json({ responses: await listResponses(params.id) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/responses");
  }
}
