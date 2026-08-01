import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import {
  triggerMilestoneCompleted,
  triggerProofApproved,
  triggerProofRejected
} from "@/lib/notification-triggers";
import { recalculateNGOHealthScore } from "@/lib/ngo-health";
import { logAdminAction } from "@/lib/admin-log";
import { isBudgetViolation, getBudgetVerdict } from "@/lib/budget-rule";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const { milestoneId, action, rejectionReason } = body;

    if (!milestoneId || !action) {
      return NextResponse.json(
        { error: "Milestone ID and action are required" },
        { status: 400 }
      );
    }

    if (action !== "APPROVE" && action !== "REJECT") {
      return NextResponse.json(
        { error: "Invalid action. Must be APPROVE or REJECT" },
        { status: 400 }
      );
    }

    if (action === "REJECT" && (!rejectionReason || !rejectionReason.trim())) {
      return NextResponse.json(
        { error: "A rejection reason is required when rejecting proof" },
        { status: 400 }
      );
    }

    // Fetch the milestone to verify its existence
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        project: true,
        proofs: {
          orderBy: { submittedAt: "desc" },
          take: 1
        }
      }
    });

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    // State guard: only a milestone actually awaiting review can be decided.
    // Without this, an already-COMPLETED milestone could be "approved" again,
    // re-firing the donor milestone-completed emails and re-emitting the impact
    // event to every subscriber. Mirrors review-project and verify-ngo.
    if (milestone.status !== "PROOF_SUBMITTED") {
      return NextResponse.json(
        { error: `Milestone is not awaiting review (current status: ${milestone.status}).` },
        { status: 409 }
      );
    }

    const adminId = auth.session.user.id;
    const latestProof = milestone.proofs[0] ?? null;
    const aiScore = latestProof?.aiValidationScore ?? null;

    // No evidence, no release. The AI-override and budget-rule gates below both
    // read off `latestProof`, so a milestone with no proof row would sail past
    // every check with aiScore = null and unlock funds on no evidence at all —
    // the exact opposite of what this platform promises donors.
    if (!latestProof) {
      return NextResponse.json(
        { error: "This milestone has no submitted proof to review." },
        { status: 409 }
      );
    }

    // AI override friction: approving a proof the AI scored below 40 requires
    // a written justification (recorded as the disagreement reason).
    const overrodeAi = action === "APPROVE" && aiScore !== null && aiScore < 40;
    if (overrodeAi && (!rejectionReason || !rejectionReason.trim())) {
      return NextResponse.json(
        { error: `A justification note is required to approve proof the AI scored ${aiScore}/100.` },
        { status: 400 }
      );
    }

    // Strict budget rule: approving a proof that fails budget compliance
    // (over budget / no receipts / unclear) also requires a written justification.
    // Enforced here so it can't be bypassed by calling the API directly. Read
    // through the shared parser so this verdict matches what the admin UI showed.
    const budgetStatus = getBudgetVerdict(latestProof?.aiValidationResult)?.status ?? null;
    const overrodeBudget = action === "APPROVE" && isBudgetViolation(budgetStatus);
    if (overrodeBudget && (!rejectionReason || !rejectionReason.trim())) {
      return NextResponse.json(
        { error: `A justification note is required to approve proof that fails the budget rule (${budgetStatus}).` },
        { status: 400 }
      );
    }

    if (action === "APPROVE") {
      // Conditioned on the status still being PROOF_SUBMITTED — the findUnique
      // check above leaves a race window in which two concurrent approvals both
      // pass, releasing the instalment twice and double-notifying every donor.
      const { count } = await prisma.milestone.updateMany({
        where: { id: milestoneId, status: "PROOF_SUBMITTED" },
        data: { status: "COMPLETED" }
      });
      if (count === 0) {
        return NextResponse.json(
          { error: "This milestone was just decided by another admin action. Refresh and check its current status." },
          { status: 409 }
        );
      }

      await prisma.milestoneReview.create({
        data: {
          milestoneId,
          proofId: latestProof?.id ?? null,
          adminId,
          action: "APPROVED",
          note: rejectionReason?.trim() || null,
          aiScore,
        }
      });

      await logAdminAction({
        adminId,
        action: "PROOF_APPROVED",
        entityType: "MILESTONE",
        entityId: milestoneId,
        oldValue: { status: milestone.status },
        newValue: { status: "COMPLETED" },
        note: rejectionReason?.trim() || null,
        metadata: {
          proofId: latestProof?.id ?? null,
          ai: aiScore !== null ? { score: aiScore } : null,
          overrodeAi,
          ...(overrodeAi ? { disagreementReason: rejectionReason.trim() } : {}),
          budgetStatus,
          overrodeBudget,
          ...(overrodeBudget ? { budgetJustification: rejectionReason.trim() } : {}),
        },
        request,
      });

      await triggerMilestoneCompleted(milestoneId);
      await triggerProofApproved(milestoneId);

      // Impact feed: admin-verified completion, delivered to every subscribed
      // donor through the outbox (guaranteed, retried — not fire-and-forget).
      try {
        const { emitProjectImpactEvent } = await import("@/lib/impact-events");
        await emitProjectImpactEvent({
          projectId: milestone.projectId,
          milestoneId,
          type: "MILESTONE_COMPLETED",
          title: `Milestone completed: "${milestone.title}"`,
          body: `Evidence for this milestone was reviewed and verified by our admin team. Your contribution to "${milestone.project.title}" delivered real, verified impact.`,
          payload: {
            proofId: latestProof?.id ?? null,
            aiScore,
            verifiedById: adminId,
            mediaUrls: latestProof?.mediaUrls ?? [],
          },
        });
      } catch (impactErr) {
        // Donors subscribed to this project silently never hear that their
        // milestone completed — the whole point of the impact feed.
        captureError(impactErr, {
          scope: "admin/review-proof",
          operation: "emit_impact_event",
          entityType: "MILESTONE",
          entityId: milestoneId,
          userId: adminId,
        });
      }

      try {
        await recalculateNGOHealthScore(milestone.project.ngoId);
      } catch (healthErr) {
        // Health score silently goes stale and keeps being shown to donors as
        // if it were current.
        captureError(healthErr, {
          scope: "admin/review-proof",
          operation: "recalculate_health_score",
          entityType: "NGO",
          entityId: milestone.project.ngoId,
          userId: adminId,
          extra: { trigger: "proof_approved" },
        });
      }

      return NextResponse.json({ success: true, message: "Milestone proof approved successfully." });
    } else {
      const { count } = await prisma.milestone.updateMany({
        where: { id: milestoneId, status: "PROOF_SUBMITTED" },
        data: { status: "IN_PROGRESS" }
      });
      if (count === 0) {
        return NextResponse.json(
          { error: "This milestone was just decided by another admin action. Refresh and check its current status." },
          { status: 409 }
        );
      }

      await prisma.milestoneReview.create({
        data: {
          milestoneId,
          proofId: latestProof?.id ?? null,
          adminId,
          action: "REJECTED",
          note: rejectionReason.trim(),
          aiScore,
        }
      });

      await logAdminAction({
        adminId,
        action: "PROOF_REJECTED",
        entityType: "MILESTONE",
        entityId: milestoneId,
        oldValue: { status: milestone.status },
        newValue: { status: "IN_PROGRESS" },
        note: rejectionReason.trim(),
        metadata: {
          proofId: latestProof?.id ?? null,
          ai: aiScore !== null ? { score: aiScore } : null,
          overrodeAi: false,
          // Recorded on rejections too, so an audit query filtering on
          // budgetStatus sees the same shape on both decision paths.
          budgetStatus,
          overrodeBudget: false,
        },
        request,
      });

      await triggerProofRejected(milestoneId, rejectionReason);

      try {
        await recalculateNGOHealthScore(milestone.project.ngoId);
      } catch (healthErr) {
        captureError(healthErr, {
          scope: "admin/review-proof",
          operation: "recalculate_health_score",
          entityType: "NGO",
          entityId: milestone.project.ngoId,
          userId: adminId,
          extra: { trigger: "proof_rejected" },
        });
      }

      return NextResponse.json({ success: true, message: "Milestone proof rejected successfully." });
    }
  } catch (err: any) {
    console.error("Error in admin review proof endpoint:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
