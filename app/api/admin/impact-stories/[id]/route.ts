import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { selectStoryMaterial, storyTransition, withdrawalStoryUpdate } from "@/lib/impact-stories";
import { loadStoryCandidates, serializeStory } from "@/lib/impact-story-service";

/**
 * PATCH /api/admin/impact-stories/[id] { action: "PUBLISH" | "REJECT", note? }
 *
 * Admin review before any story is published. Consent is re-checked at
 * publish time, not trusted from generation: if any beneficiary material the
 * story used is no longer allowed for its audience, publishing is refused
 * (409) and the story is marked for regeneration.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
    if (!authorized) return response;

    const body = await request.json().catch(() => null);
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (body?.action === "REJECT" && !note) return NextResponse.json({ error: "A note is required when rejecting." }, { status: 400 });

    const story = await prisma.impactStory.findUnique({ where: { id: params.id } });
    if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
    const t = storyTransition(body?.action, story.status, "ADMIN");
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });

    if (t.to === "PUBLISHED" && (story.sourceFeedbackIds.length || story.sourceEvidenceIds.length)) {
      const now = selectStoryMaterial(story.variant, await loadStoryCandidates(story.projectId, story.ngoId));
      const stillOk =
        story.sourceFeedbackIds.every((id) => now.usedFeedbackIds.includes(id)) &&
        story.sourceEvidenceIds.every((id) => now.photoEvidenceIds.includes(id));
      if (!stillOk) {
        await prisma.impactStory.updateMany({ where: { id: story.id, status: story.status }, data: withdrawalStoryUpdate() });
        return NextResponse.json(
          { error: "Consent for material in this story has changed since it was generated. It was marked for regeneration.", code: "CONSENT_CHANGED" },
          { status: 409 },
        );
      }
    }

    const decidedAt = new Date();
    const { count } = await prisma.impactStory.updateMany({
      where: { id: story.id, status: story.status },
      data: {
        status: t.to,
        reviewedById: session.user.id,
        reviewedAt: decidedAt,
        reviewNote: note || null,
        ...(t.to === "PUBLISHED" ? { publishedAt: decidedAt } : {}),
      },
    });
    if (count === 0) return NextResponse.json({ error: "Another reviewer decided this story first." }, { status: 409 });

    await logAdminAction({
      adminId: session.user.id,
      action: t.to === "PUBLISHED" ? "IMPACT_STORY_PUBLISHED" : "IMPACT_STORY_REJECTED",
      entityType: "IMPACT_STORY",
      entityId: story.id,
      oldValue: { status: story.status },
      newValue: { status: t.to },
      metadata: { variant: story.variant, generator: story.generator, projectId: story.projectId },
      request,
    });

    const updated = await prisma.impactStory.findUnique({ where: { id: story.id } });
    return NextResponse.json({ story: serializeStory(updated) });
  } catch (error) {
    console.error("[api/admin/impact-stories/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to decide story" }, { status: 500 });
  }
}
