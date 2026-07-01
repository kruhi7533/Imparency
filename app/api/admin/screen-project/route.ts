import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { screenProject } from "@/lib/gemini/screen-project";

export const runtime = "nodejs";

/**
 * ADMIN-only. Runs (or re-runs) the project pre-screening agent on demand and
 * returns the result. Triggered manually from the Project Review queue — it is
 * NOT run automatically on project creation.
 *
 * Advisory only — it stores a recommendation but never changes project status.
 */
export async function POST(request: Request) {
  const { authorized, response } = await verifySessionRole("ADMIN");
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

    return NextResponse.json({ screening });
  } catch (err: any) {
    console.error("Screen-project route error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
