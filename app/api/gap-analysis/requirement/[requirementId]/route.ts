import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { runMatching } from "@/src/agents/gap-diagnoser/services/gapAnalysisService";
import { errorResponse } from "@/lib/requirements/http";

/**
 * Starts gap analysis + matching. Owner or admin only, and only for an
 * ADMIN-VALIDATED requirement (same service as POST /api/requirements/[id]/matches).
 */
export async function POST(_req: NextRequest, { params }: { params: { requirementId: string } }) {
  try {
    const actor = await requireActor();
    const result = await runMatching(params.requirementId, actor);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err, "api/gap-analysis POST");
  }
}
