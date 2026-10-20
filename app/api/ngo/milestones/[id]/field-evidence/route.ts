import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { listAttachableEvidence } from "@/lib/proof-field-evidence";

/**
 * GET /api/ngo/milestones/[id]/field-evidence — approved field evidence the
 * caller's NGO can attach to a proof for this milestone. Another NGO's
 * milestone is a 404. Notes and capture times only; the photos themselves are
 * fetched through the consent-gated photo route.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  const actor = await resolveNgoActor(session.user.id);
  if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

  const milestone = await prisma.milestone.findUnique({
    where: { id: params.id },
    select: { id: true, projectId: true, project: { select: { ngoId: true } } },
  });
  if (!milestone || milestone.project.ngoId !== actor.ngoId) {
    return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  }

  const evidence = await listAttachableEvidence(actor.ngoId, milestone.projectId, milestone.id);
  return NextResponse.json({
    evidence: evidence.map((e) => ({
      id: e.id,
      note: e.note,
      taskTitle: e.task.title,
      capturedAt: e.capturedAt.toISOString(),
      containsPeople: e.containsPeople,
    })),
  });
}
