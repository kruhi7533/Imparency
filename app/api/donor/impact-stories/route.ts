import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveDonorAccount } from "@/lib/donor-team";
import { serializeStory } from "@/lib/impact-story-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/donor/impact-stories?projectId= — PUBLISHED stories (donor and
 * public variants) on a project the caller's account funds through an
 * ACTIVE/COMPLETED contract. A story unpublished by consent withdrawal is gone
 * from here immediately (status filter).
 */
export async function GET(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.DONOR);
    if (!authorized) return response;
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

    const account = await resolveDonorAccount(session.user.id);
    const funds = await prisma.contract.findFirst({
      where: { donorId: account.accountId, projectId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { id: true },
    });
    if (!funds) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const stories = await prisma.impactStory.findMany({
      where: { projectId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ stories: stories.map(serializeStory) });
  } catch (error) {
    console.error("[api/donor/impact-stories] GET error:", error);
    return NextResponse.json({ error: "Failed to load stories" }, { status: 500 });
  }
}
