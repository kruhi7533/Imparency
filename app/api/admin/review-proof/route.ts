import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import {
  triggerMilestoneCompleted,
  triggerProofApproved,
  triggerProofRejected
} from "@/lib/notification-triggers";

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
        proofs: {
          orderBy: { submittedAt: "desc" },
          take: 1
        }
      }
    });

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    if (action === "APPROVE") {
      // Update status to COMPLETED
      await prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: "COMPLETED" }
      });

      // Trigger parallel batch narratives generation & notifications for donors
      // and NGO approval notification asynchronously
      // (using await to ensure they complete or run cleanly)
      await triggerMilestoneCompleted(milestoneId);
      await triggerProofApproved(milestoneId);

      return NextResponse.json({
        success: true,
        message: "Milestone proof approved successfully."
      });
    } else {
      // Update status to IN_PROGRESS so NGO can resubmit
      await prisma.milestone.update({
        where: { id: milestoneId },
        data: { status: "IN_PROGRESS" }
      });

      // Optionally record the rejection reason somewhere (e.g. log, or notification trigger handles it)
      await triggerProofRejected(milestoneId, rejectionReason);

      return NextResponse.json({
        success: true,
        message: "Milestone proof rejected successfully."
      });
    }
  } catch (err: any) {
    console.error("Error in admin review proof endpoint:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
