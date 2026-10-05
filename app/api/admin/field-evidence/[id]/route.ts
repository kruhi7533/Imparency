import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkReview, isReviewDecision } from "@/lib/field-evidence";

/**
 * Review one piece of field evidence: APPROVE, REQUEST_RESUBMIT or REJECT.
 *
 * Approval is the human gate in front of donor visibility (together with
 * beneficiary consent — see isShareableWithDonor). Approve completes the task;
 * a resubmission request reopens it for the field worker.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
    if (!authorized) return response;
    const adminId: string = session.user.id;

    const evidence = await prisma.fieldEvidence.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, taskId: true, projectId: true },
    });
    if (!evidence) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    if (!isReviewDecision(body.decision)) {
      return NextResponse.json({ error: "decision must be APPROVE, REQUEST_RESUBMIT or REJECT." }, { status: 400 });
    }
    const check = checkReview(evidence.status, body.decision, body.note);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (check.noop) return NextResponse.json({ ok: true, status: evidence.status, replayed: true });

    const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
    const moved = await prisma.$transaction(async (tx) => {
      const { count } = await tx.fieldEvidence.updateMany({
        where: { id: evidence.id, status: "PENDING_REVIEW" },
        data: { status: check.target, reviewedById: adminId, reviewedAt: new Date(), reviewNote: note },
      });
      if (count === 0) return false;
      if (body.decision === "APPROVE") {
        await tx.fieldTask.updateMany({ where: { id: evidence.taskId, status: { not: "CANCELLED" } }, data: { status: "COMPLETED" } });
      } else if (body.decision === "REQUEST_RESUBMIT") {
        await tx.fieldTask.updateMany({ where: { id: evidence.taskId, status: "SUBMITTED" }, data: { status: "OPEN" } });
      }
      return true;
    });
    if (!moved) return NextResponse.json({ error: "Someone else reviewed this just now. Refresh." }, { status: 409 });

    await logAdminAction({
      adminId,
      action: "FIELD_EVIDENCE_REVIEWED",
      entityType: "FIELD_EVIDENCE",
      entityId: evidence.id,
      oldValue: { status: evidence.status },
      newValue: { status: check.target },
      note,
      metadata: { taskId: evidence.taskId, projectId: evidence.projectId },
      request,
    });

    return NextResponse.json({ ok: true, status: check.target });
  } catch (error) {
    console.error("[api/admin/field-evidence/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to review evidence" }, { status: 500 });
  }
}
