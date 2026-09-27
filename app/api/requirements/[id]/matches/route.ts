import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { getLatestMatchRun, runMatching } from "@/src/agents/gap-diagnoser/services/gapAnalysisService";
import { serializeMatchRun } from "@/lib/requirements/dto";
import { errorResponse } from "@/lib/requirements/http";

/** Latest ranked shortlist with per-dimension explanations (owner/admin). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const run = await getLatestMatchRun(params.id, actor);
    return NextResponse.json({ run: run ? serializeMatchRun(run) : null });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/matches GET");
  }
}

/** "Find Matches": owner/admin, only on an ADMIN-VALIDATED requirement (or a rematch before invitations). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const result = await runMatching(params.id, actor);
    const run = await getLatestMatchRun(params.id, actor);
    return NextResponse.json({ ...result, run: run ? serializeMatchRun(run) : null });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/matches POST");
  }
}
