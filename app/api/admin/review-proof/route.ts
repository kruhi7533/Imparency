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

    const adminId = auth.session.user.id;
    const latestProof = milestone.proofs[0] ?? null;
    const aiScore = latestProof?.aiValidationScore ?? null;

    // AI override friction: approving a proof the AI scored below 40 requires
    // a written justification (recorded as the disagreement reason).
    const overrodeAi = action === "APPROVE" && aiScore !== null && aiScore < 40;
    if (overrodeAi && (!rejectionReason || !rejectionReason.trim())) {
      return NextResponse.json(
        { error: `A justification note is required to approve proof the AI scored ${aiScore}/100.` },
        { status: 400 }
      );
    }

    if (action === "APPROVE") {
      await prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: "COMPLETED" }
      });

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
        console.error("Failed to emit impact event on proof approval:", impactErr);
      }

      try {
        await recalculateNGOHealthScore(milestone.project.ngoId);
      } catch (healthErr) {
        console.error("Failed to recalculate health score on proof approval:", healthErr);
      }

      return NextResponse.json({ success: true, message: "Milestone proof approved successfully." });
    } else {
      await prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: "IN_PROGRESS" }
      });

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
        },
        request,
      });

      await triggerProofRejected(milestoneId, rejectionReason);

      try {
        await recalculateNGOHealthScore(milestone.project.ngoId);
      } catch (healthErr) {
        console.error("Failed to recalculate health score on proof rejection:", healthErr);
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
