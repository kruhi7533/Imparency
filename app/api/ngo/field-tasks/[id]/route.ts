import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { EDITABLE_TASK_STATUS, canManageTasks, parseTaskEdit, resolveNgoActor } from "@/lib/field-evidence";

/**
 * PATCH /api/ngo/field-tasks/[id] — edit or cancel a field task.
 *
 *   { action: "EDIT", title?, instructions?, assignedToId?, milestoneId?, dueDate? }
 *   { action: "CANCEL" }
 *
 * OWNER/ADMIN only, and the task must be this NGO's (another NGO's task is a
 * 404, so its existence is not disclosed). Only an OPEN task changes; the write
 * is a compare-and-swap on that status, so evidence syncing at the same moment
 * (which moves the task to SUBMITTED) wins and this returns 409.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;

    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });
    if (!canManageTasks(actor)) {
      return NextResponse.json({ error: "Only NGO owners or admins can change field tasks." }, { status: 403 });
    }

    const task = await prisma.fieldTask.findUnique({
      where: { id: params.id },
      select: { id: true, ngoId: true, projectId: true, status: true },
    });
    if (!task || task.ngoId !== actor.ngoId) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const parsed = parseTaskEdit(await request.json().catch(() => ({})));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const edit = parsed.value;

    if (task.status !== EDITABLE_TASK_STATUS) {
      return NextResponse.json(
        { error: task.status === "SUBMITTED" ? "Evidence for this task is waiting for review, so it can't be changed now." : `A ${task.status.toLowerCase()} task can't be changed.` },
        { status: 409 }
      );
    }

    let data: Record<string, unknown>;
    if (edit.action === "CANCEL") {
      data = { status: "CANCELLED" };
    } else {
      const c = edit.changes;
      if (c.milestoneId) {
        const m = await prisma.milestone.findFirst({ where: { id: c.milestoneId, projectId: task.projectId }, select: { id: true } });
        if (!m) return NextResponse.json({ error: "That milestone is not on this project." }, { status: 400 });
      }
      if (c.assignedToId) {
        const [ownerProfile, member] = await Promise.all([
          prisma.nGOProfile.findUnique({ where: { userId: c.assignedToId }, select: { id: true } }),
          prisma.nGOTeamMember.findFirst({ where: { userId: c.assignedToId, ngoId: actor.ngoId }, select: { id: true } }),
        ]);
        if (ownerProfile?.id !== actor.ngoId && !member) {
          return NextResponse.json({ error: "The assignee is not on your NGO's team." }, { status: 400 });
        }
      }
      data = c;
    }

    const { count } = await prisma.fieldTask.updateMany({ where: { id: task.id, status: EDITABLE_TASK_STATUS }, data });
    if (count === 0) {
      return NextResponse.json({ error: "The task changed while you were editing it. Reload and try again." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, action: edit.action });
  } catch (error) {
    console.error("[api/ngo/field-tasks/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}
