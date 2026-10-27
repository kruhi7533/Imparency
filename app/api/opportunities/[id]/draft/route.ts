import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { requireActor } from "@/lib/requirements/access";
import { generateProposalDraft } from "@/lib/requirements/proposal-draft";
import { errorResponse, readJson } from "@/lib/requirements/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI-005 — NGO proposal-assist. Body: { projectId? }. Returns
 * { draft, generator: "CLAUDE" | "GEMINI" | "TEMPLATE", notice }. Only for an
 * NGO invited to this opportunity; never submits anything.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { isBlocked, response: limited } = await checkRateLimit(request, "opportunities/draft", 10, 300);
    if (isBlocked && limited) return limited;
    const actor = await requireActor();
    const body = await readJson(request);
    return NextResponse.json(await generateProposalDraft({ requirementId: params.id, actor, projectId: body.projectId }));
  } catch (err) {
    return errorResponse(err, "api/opportunities/[id]/draft");
  }
}
