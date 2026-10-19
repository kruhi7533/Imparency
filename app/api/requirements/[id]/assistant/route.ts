import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { answerProposalQuestion } from "@/lib/requirements/proposal-assistant";
import { errorResponse, readJson } from "@/lib/requirements/http";
import { checkRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

/**
 * Grounded Q&A over this requirement's NGO proposals (owner or admin).
 * Body: { question }. Answers cite numbered sources; unknown citations are stripped.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { isBlocked, response: limited } = await checkRateLimit(request, "proposal-assistant", 20, 300);
    if (isBlocked && limited) return limited;
    const actor = await requireActor();
    const body = await readJson(request);
    return NextResponse.json(await answerProposalQuestion({ requirementId: params.id, actor, question: body.question }));
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/assistant");
  }
}
