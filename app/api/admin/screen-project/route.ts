import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { screenProject } from "@/lib/gemini/screen-project";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * ADMIN-only. Runs (or re-runs) the project pre-screening agent on demand and
 * returns the result. Triggered manually from the Project Review queue — it is
 * NOT run automatically on project creation.
 *
 * Advisory only — it stores a recommendation but never changes project status.
 */
export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  const rl = await checkRateLimit(request, "admin/screen-project", 20, 60);
  if (rl.isBlocked) return rl.response!;

  try {
    const { projectId } = await request.json();
    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { milestones: { orderBy: { sequenceOrder: "asc" } } },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const screening = await screenProject(
      {
        title: project.title,
        description: project.description,
        causeCategory: project.causeCategory,
        targetAmount: Number(project.targetAmount),
        location: project.location,
        problemStatement: project.problem_statement,
        expectedOutcome: project.expected_outcome,
      },
      project.milestones.map((m) => ({
        title: m.title,
        description: m.description,
        targetAmount: Number(m.targetAmount),
        deadline: m.deadline,
      }))
    );

    await prisma.project.update({
      where: { id: projectId },
      data: {
        aiScreeningScore: screening.score,
        aiScreeningResult: JSON.stringify(screening),
      },
    });

    // Advisory, but it writes: aiScreeningScore is what a reviewer sees next to
    // the Approve button. Recording the score that was stored keeps the advice
    // a human acted on recoverable after a later re-run overwrites it.
    await logAdminAction({
      adminId: session.user.id,
      action: "PROJECT_SCREENED",
      entityType: "PROJECT",
      entityId: projectId,
      oldValue: { aiScreeningScore: project.aiScreeningScore ?? null },
      newValue: { aiScreeningScore: screening.score },
      note: "Ran the project pre-screening agent",
      request,
    });

    return NextResponse.json({ screening });
  } catch (err: any) {
    console.error("Screen-project route error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
