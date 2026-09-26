import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { listRequirementsForActor } from "@/lib/requirements/queries";
import { errorResponse, readJson } from "@/lib/requirements/http";
import { createRequirementFromForm } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";

const STATUSES = new Set([
  "UPLOADED", "PROCESSING", "AI_EXTRACTED", "DONOR_REVIEW", "PENDING_ADMIN_REVIEW", "NEEDS_CORRECTION",
  "VALIDATED", "MATCHING", "SHORTLISTED", "NGO_RESPONSE", "SELECTED", "CONTRACTED", "REJECTED", "FAILED",
]);

/** Donor → their own requirements. Admin → all (optional ?status=). NGO → 403. */
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const status = new URL(request.url).searchParams.get("status");
    const requirements = await listRequirementsForActor(actor, {
      status: status && STATUSES.has(status) ? (status as any) : undefined,
    });
    return NextResponse.json({ requirements });
  } catch (err) {
    return errorResponse(err, "api/requirements GET");
  }
}

/** Donor creates a requirement from the structured form (no document upload). */
export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const requirement = await createRequirementFromForm(actor, await readJson(request));
    return NextResponse.json({ requirement: serializeRequirement(requirement) }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "api/requirements POST");
  }
}
