import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/impact-stories?projectId= — public. Only PUBLISHED stories of the
 * PUBLIC variant, whose material passed the PUBLIC consent filter and an admin
 * review. Photos are not included (they are served only to authenticated
 * parties through /api/field/evidence/[id]/photo).
 */
export async function GET(request: Request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    const stories = await prisma.impactStory.findMany({
      where: { projectId, variant: "PUBLIC", status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 10,
      select: { id: true, title: true, body: true, publishedAt: true, generator: true },
    });
    return NextResponse.json({
      stories: stories.map((s) => ({ id: s.id, title: s.title, body: s.body, generator: s.generator, publishedAt: s.publishedAt?.toISOString() ?? null })),
    });
  } catch (error) {
    console.error("[api/impact-stories] GET error:", error);
    return NextResponse.json({ error: "Failed to load stories" }, { status: 500 });
  }
}
