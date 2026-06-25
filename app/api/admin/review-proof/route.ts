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
          aiScore: latestProof?.aiValidationScore ?? null,
        }
      });

      await triggerMilestoneCompleted(milestoneId);
      await triggerProofApproved(milestoneId);

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
          aiScore: latestProof?.aiValidationScore ?? null,
        }
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
