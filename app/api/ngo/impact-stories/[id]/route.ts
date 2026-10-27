import { NextResponse } from "next/server";
import { Role, TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { storyTransition } from "@/lib/impact-stories";
import { serializeStory } from "@/lib/impact-story-service";

const CAN_EDIT: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN];

/** PATCH — edit a DRAFT ({ title?, body? }) or submit it for admin review ({ action: "SUBMIT" }). */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

    const story = await prisma.impactStory.findUnique({ where: { id: params.id } });
    if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
    if (story.ngoId !== actor.ngoId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!CAN_EDIT.includes(actor.teamRole)) return NextResponse.json({ error: "Only an owner or admin can edit stories." }, { status: 403 });

    const body = await request.json().catch(() => null);
    let data: Record<string, unknown>;
    if (body?.action !== undefined) {
      const t = storyTransition(body.action, story.status, "NGO");
      if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
      data = { status: t.to, submittedAt: new Date() };
    } else {
      if (story.status !== "DRAFT") return NextResponse.json({ error: `A ${story.status} story cannot be edited.` }, { status: 409 });
      data = {};
      if (typeof body?.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 200);
      if (typeof body?.body === "string" && body.body.trim()) data.body = body.body.trim().slice(0, 4000);
      if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const { count } = await prisma.impactStory.updateMany({ where: { id: story.id, status: story.status }, data });
    if (count === 0) return NextResponse.json({ error: "The story changed. Reload." }, { status: 409 });
    const updated = await prisma.impactStory.findUnique({ where: { id: story.id } });
    return NextResponse.json({ story: serializeStory(updated) });
  } catch (error) {
    console.error("[api/ngo/impact-stories/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update story" }, { status: 500 });
  }
}
