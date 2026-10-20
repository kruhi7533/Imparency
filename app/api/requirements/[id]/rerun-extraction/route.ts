import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { rerunExtraction } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse } from "@/lib/requirements/http";

export const runtime = "nodejs";

/** Owner: retry a FAILED extraction. Admin: re-run at any review stage. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const rl = await checkRateLimit(request, "requirements/rerun-extraction", 5, 300);
  if (rl.isBlocked) return rl.response;
  try {
    const actor = await requireActor();
    const updated = await rerunExtraction(params.id, actor, request);
    return NextResponse.json({ requirement: serializeRequirement(updated, { includeRawText: true }) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/rerun-extraction");
  }
}
