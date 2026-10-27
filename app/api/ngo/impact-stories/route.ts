import { NextResponse } from "next/server";
import { Role, TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { generateStory, serializeStory } from "@/lib/impact-story-service";

export const dynamic = "force-dynamic";

const CAN_GENERATE: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN];

/** GET /api/ngo/impact-stories — this organisation's stories, newest first. */
export async function GET() {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });
    const stories = await prisma.impactStory.findMany({ where: { ngoId: actor.ngoId }, orderBy: { createdAt: "desc" }, take: 100 });
    return NextResponse.json({ stories: stories.map(serializeStory), canGenerate: CAN_GENERATE.includes(actor.teamRole) });
  } catch (error) {
    console.error("[api/ngo/impact-stories] GET error:", error);
    return NextResponse.json({ error: "Failed to load stories" }, { status: 500 });
  }
}

/**
 * POST { projectId, variant: "PUBLIC" | "DONOR", contractId? }
 *
 * Generates a DRAFT story from consent-filtered material and verified figures.
 * Uses the model when GEMINI_API_KEY is set; with no key (or a failed or
 * rule-breaking model draft) a deterministic template draft is stored instead,
 * generator TEMPLATE, and the response says why (`fallbackReason`). Either
 * way an admin reviews before publication.
 */
export async function POST(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });
    if (!CAN_GENERATE.includes(actor.teamRole)) {
      return NextResponse.json({ error: "Only an owner or admin can generate stories." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const projectId = typeof body?.projectId === "string" ? body.projectId : "";
    const variant = body?.variant;
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    if (variant !== "PUBLIC" && variant !== "DONOR") return NextResponse.json({ error: "variant must be PUBLIC or DONOR" }, { status: 400 });

    let contractId: string | null = null;
    if (typeof body?.contractId === "string" && body.contractId) {
      const c = await prisma.contract.findUnique({ where: { id: body.contractId }, select: { id: true, ngoId: true, projectId: true } });
      if (!c || c.ngoId !== actor.ngoId || c.projectId !== projectId) {
        return NextResponse.json({ error: "Contract not found for this project" }, { status: 404 });
      }
      contractId = c.id;
    }

    const result = await generateStory({
      ngoId: actor.ngoId,
      projectId,
      contractId,
      variant,
      userId: session.user.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    const story = await prisma.impactStory.findUnique({ where: { id: result.storyId } });
    return NextResponse.json({ story: serializeStory(story), fallbackReason: result.fallbackReason }, { status: 201 });
  } catch (error) {
    console.error("[api/ngo/impact-stories] POST error:", error);
    return NextResponse.json({ error: "Failed to generate story" }, { status: 500 });
  }
}
