import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { submitInterest } from "@/lib/requirements/opportunities";
import { errorResponse, readJson } from "@/lib/requirements/http";

/**
 * NGO expresses interest / submits a proposal.
 * Body: { projectId?, proposedBudget?, proposedDurationMonths?, implementationPlan?,
 *         expectedOutcomes?, complianceNotes?, milestones?: [{ title, amount?, durationMonths? }] }
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const body = await readJson(request);
    const response = await submitInterest(params.id, actor, body);
    return NextResponse.json({ response }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "api/opportunities/[id]/interest");
  }
}
