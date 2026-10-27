import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkReview, evidenceFlags, isReviewDecision, isShareableWithDonor } from "@/lib/field-evidence";
import { notifyContractDonorsEvidenceApproved } from "@/lib/contract-donor-updates";

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
      select: {
        id: true,
        status: true,
        taskId: true,
        projectId: true,
        containsPeople: true,
        duplicateVerdict: true,
        duplicateOfId: true,
        locationStatus: true,
        feedback: { select: { consentToSharePhoto: true, withdrawnAt: true } },
        task: { select: { project: { select: { title: true } }, milestone: { select: { title: true } } } },
      },
    });
    if (!evidence) return NextResponse.json({ error: "Evidence not found", code: "NOT_FOUND" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    if (!isReviewDecision(body.decision)) {
      return NextResponse.json({ error: "decision must be APPROVE, REQUEST_RESUBMIT or REJECT.", code: "INVALID_DECISION" }, { status: 400 });
    }
    const flags = evidenceFlags(evidence);
    const check = checkReview(evidence.status, body.decision, body.note, flags);
    if (!check.ok) return NextResponse.json({ error: check.error, code: check.code, flags }, { status: check.status });
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
      } else {
        // Returned or rejected: the task still has no accepted evidence, so it
        // reopens for a new capture (the rework loop). A rejected row stays
        // rejected and can never be cited; only the task moves.
        await tx.fieldTask.updateMany({ where: { id: evidence.taskId, status: "SUBMITTED" }, data: { status: "OPEN" } });
      }
      return true;
    });
    if (!moved) return NextResponse.json({ error: "Someone else reviewed this just now. Refresh.", code: "REVIEW_CONFLICT" }, { status: 409 });

    await logAdminAction({
      adminId,
      action: "FIELD_EVIDENCE_REVIEWED",
      entityType: "FIELD_EVIDENCE",
      entityId: evidence.id,
      oldValue: { status: evidence.status },
      newValue: { status: check.target },
      note,
      // Flag codes only: an approval over a DUPLICATE_IMAGE / GPS_MISMATCH flag
      // is a recorded human override of the automatic check.
      metadata: { taskId: evidence.taskId, projectId: evidence.projectId, flags, overriddenFlags: check.override },
      request,
    });

    // Week 7 donor: tell funding donors — but only about evidence they can
    // actually open. Approved-but-unconsented evidence stays silent.
    // The decision has committed; a notification problem must not turn it into a 500.
    if (check.target === "APPROVED" && isShareableWithDonor({ status: check.target, containsPeople: evidence.containsPeople }, evidence.feedback)) {
      try {
        await notifyContractDonorsEvidenceApproved({
          projectId: evidence.projectId,
          projectTitle: evidence.task.project.title,
          milestoneTitle: evidence.task.milestone?.title ?? null,
        });
      } catch (err) {
        console.error("[api/admin/field-evidence/[id]] donor notification failed:", err);
      }
    }

    return NextResponse.json({ ok: true, status: check.target, overriddenFlags: check.override });
  } catch (error) {
    console.error("[api/admin/field-evidence/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to review evidence" }, { status: 500 });
  }
}
