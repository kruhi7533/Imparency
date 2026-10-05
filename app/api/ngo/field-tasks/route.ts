import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { canManageTasks, parseTaskInput, resolveNgoActor } from "@/lib/field-evidence";

/**
 * Field tasks for the caller's NGO. Owners/admins see every task; everyone
 * else sees only the tasks assigned to them. Never another NGO's.
 */
export async function GET() {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;

    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

    const tasks = await prisma.fieldTask.findMany({
      where: {
        ngoId: actor.ngoId,
        status: { not: "CANCELLED" },
        ...(canManageTasks(actor) ? {} : { assignedToId: session.user.id }),
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        project: { select: { id: true, title: true, location: true } },
        milestone: { select: { id: true, title: true } },
        evidence: { select: { id: true, status: true, reviewNote: true, syncedAt: true }, orderBy: { syncedAt: "desc" } },
      },
    });

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("[api/ngo/field-tasks] GET error:", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }
}

/** Assign a field task. OWNER/ADMIN only; project, milestone and assignee must all be this NGO's. */
export async function POST(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;

    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });
    if (!canManageTasks(actor)) {
      return NextResponse.json({ error: "Only NGO owners or admins can assign field tasks." }, { status: 403 });
    }

    const parsed = parseTaskInput(await request.json().catch(() => ({})));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const input = parsed.value;

    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { ngoId: true, isDeleted: true, milestones: { select: { id: true } } },
    });
    if (!project || project.isDeleted || project.ngoId !== actor.ngoId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (input.milestoneId && !project.milestones.some((m) => m.id === input.milestoneId)) {
      return NextResponse.json({ error: "That milestone is not on this project." }, { status: 400 });
    }

    // The assignee must be on this NGO: its owner, or a team member.
    const [ownerProfile, member] = await Promise.all([
      prisma.nGOProfile.findUnique({ where: { userId: input.assignedToId }, select: { id: true } }),
      prisma.nGOTeamMember.findFirst({ where: { userId: input.assignedToId, ngoId: actor.ngoId }, select: { id: true } }),
    ]);
    if (ownerProfile?.id !== actor.ngoId && !member) {
      return NextResponse.json({ error: "The assignee is not on your NGO's team." }, { status: 400 });
    }

    const task = await prisma.fieldTask.create({
      data: { ...input, ngoId: actor.ngoId, createdById: session.user.id },
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("[api/ngo/field-tasks] POST error:", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
