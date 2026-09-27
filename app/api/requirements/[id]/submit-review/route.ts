import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { submitForAdminReview } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse } from "@/lib/requirements/http";

/** Owner: DONOR_REVIEW / NEEDS_CORRECTION (or AI_EXTRACTED) → PENDING_ADMIN_REVIEW. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const updated = await submitForAdminReview(params.id, actor);
    return NextResponse.json({ requirement: serializeRequirement(updated) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/submit-review");
  }
}
