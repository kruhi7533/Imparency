import { NextResponse } from "next/server";
import { requireActor, assertAdmin, loadRequirementForActor } from "@/lib/requirements/access";
import { listAuditTrail } from "@/lib/requirements/queries";
import { errorResponse } from "@/lib/requirements/http";

/** Full audit trail — admin only (donors see version history; NGOs see neither). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    assertAdmin(actor);
    await loadRequirementForActor(params.id, actor);
    return NextResponse.json({ events: await listAuditTrail(params.id) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/audit");
  }
}
