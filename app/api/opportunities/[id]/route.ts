import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { getOpportunityForNgo } from "@/lib/requirements/opportunities";
import { errorResponse } from "@/lib/requirements/http";

/** NGO: one sanitized opportunity brief (403 unless this NGO was invited). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    return NextResponse.json({ opportunity: await getOpportunityForNgo(params.id, actor) });
  } catch (err) {
    return errorResponse(err, "api/opportunities/[id] GET");
  }
}
