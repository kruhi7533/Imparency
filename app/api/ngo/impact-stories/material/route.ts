import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { selectStoryMaterial } from "@/lib/impact-stories";
import { loadStoryCandidates } from "@/lib/impact-story-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/ngo/impact-stories/material?projectId= — the beneficiary feedback on
 * one of the caller's projects, with its consent state and what each story
 * variant would use. Lets the NGO record story consent and see, before
 * generating, exactly what the consent filter will include.
 */
export async function GET(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { ngoId: true } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (project.ngoId !== actor.ngoId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const candidates = await loadStoryCandidates(projectId, actor.ngoId);
    const donor = selectStoryMaterial("DONOR", candidates);
    const pub = selectStoryMaterial("PUBLIC", candidates);
    return NextResponse.json({
      items: candidates
        .filter((c) => c.feedbackId)
        .map((c) => ({
          feedbackId: c.feedbackId,
          evidenceId: c.evidenceId,
          preview: c.feedbackText ? c.feedbackText.slice(0, 140) : null,
          consentToRecord: c.consentToRecord,
          consentToSharePhoto: c.consentToSharePhoto,
          storyConsent: c.storyConsent,
          withdrawn: !!c.withdrawnAt,
          evidenceStatus: c.evidenceStatus,
          usedInDonor: donor.usedFeedbackIds.includes(c.feedbackId!),
          usedInPublic: pub.usedFeedbackIds.includes(c.feedbackId!),
        })),
      summary: {
        donor: { quotes: donor.quotes.length, photos: donor.photoEvidenceIds.length, excluded: donor.excluded.length },
        public: { quotes: pub.quotes.length, photos: pub.photoEvidenceIds.length, excluded: pub.excluded.length },
      },
    });
  } catch (error) {
    console.error("[api/ngo/impact-stories/material] GET error:", error);
    return NextResponse.json({ error: "Failed to load material" }, { status: 500 });
  }
}
