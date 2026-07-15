import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { sendProjectPublishedEmail, sendProjectRejectedEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const { projectId, action, rejectionReason } = body;

    if (!projectId || !action) {
      return NextResponse.json(
        { error: "Project ID and action are required" },
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
        { error: "A rejection reason is required when rejecting a project" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        ngo: {
          include: { user: { select: { email: true } } },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Only projects awaiting approval can be acted on — prevents re-approving a
    // live project or double-processing.
    if (project.status !== "PENDING_APPROVAL") {
      return NextResponse.json(
        { error: `Project is not awaiting approval (current status: ${project.status}).` },
        { status: 409 }
      );
    }

    const adminId = auth.session.user.id;
    const ngoEmail = project.ngo.user.email;

    // AI decision snapshot: capture what the screening said at decision time,
    // and require a written reason when approving against a low AI score.
    let aiRecommendation: string | null = null;
    try {
      aiRecommendation = project.aiScreeningResult
        ? JSON.parse(project.aiScreeningResult)?.recommendation ?? null
        : null;
    } catch {
      aiRecommendation = null;
    }
    const aiScore = project.aiScreeningScore ?? null;
    const overrodeAi = action === "APPROVE" && aiScore !== null && aiScore < 40;

    if (overrodeAi && (!rejectionReason || !rejectionReason.trim())) {
      // rejectionReason doubles as the free-text note field on this endpoint
      return NextResponse.json(
        { error: `A justification note is required to approve a project the AI scored ${aiScore}/100.` },
        { status: 400 }
      );
    }

    if (action === "APPROVE") {
      // Conditioned on the status still being PENDING_APPROVAL — the earlier
      // findUnique check alone leaves a race window where two concurrent
      // requests could both pass and double-approve/publish the project.
      const { count } = await prisma.project.updateMany({
        where: { id: projectId, status: "PENDING_APPROVAL" },
        data: {
          status: "ACTIVE",
          reviewNote: null,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
      });
      if (count === 0) {
        return NextResponse.json(
          { error: "Project was just decided by another admin action. Refresh and check its current status." },
          { status: 409 }
        );
      }

      await prisma.projectReview.create({
        data: { projectId, adminId, action: "APPROVED", note: rejectionReason?.trim() || null },
      });

      await logAdminAction({
        adminId,
        action: "PROJECT_APPROVED",
        entityType: "PROJECT",
        entityId: projectId,
        oldValue: { status: "PENDING_APPROVAL" },
        newValue: { status: "ACTIVE" },
        note: rejectionReason?.trim() || null,
        metadata: {
          ai: aiScore !== null ? { score: aiScore, recommendation: aiRecommendation } : null,
          overrodeAi,
          ...(overrodeAi ? { disagreementReason: rejectionReason.trim() } : {}),
        },
        request,
      });

      // Now that the project is live, notify the NGO and its followers.
      await sendProjectPublishedEmail(ngoEmail, project.ngo.orgName, project.title);

      try {
        const { triggerFollowedNGONewProject } = require("@/lib/notification-triggers");
        await triggerFollowedNGONewProject(project.ngoId, project.id);
      } catch (triggerErr) {
        console.error("Failed to trigger new project follower notifications:", triggerErr);
      }

      return NextResponse.json({ success: true, message: "Project approved and published." });
    } else {
      const reason = rejectionReason.trim();

      const { count } = await prisma.project.updateMany({
        where: { id: projectId, status: "PENDING_APPROVAL" },
        data: {
          status: "DRAFT",
          reviewNote: reason,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
      });
      if (count === 0) {
        return NextResponse.json(
          { error: "Project was just decided by another admin action. Refresh and check its current status." },
          { status: 409 }
        );
      }

      await prisma.projectReview.create({
        data: { projectId, adminId, action: "REJECTED", note: reason },
      });

      await logAdminAction({
        adminId,
        action: "PROJECT_REJECTED",
        entityType: "PROJECT",
        entityId: projectId,
        oldValue: { status: "PENDING_APPROVAL" },
        newValue: { status: "DRAFT" },
        note: reason,
        metadata: {
          ai: aiScore !== null ? { score: aiScore, recommendation: aiRecommendation } : null,
          overrodeAi: false,
        },
        request,
      });

      await sendProjectRejectedEmail(ngoEmail, project.ngo.orgName, project.title, reason);

      return NextResponse.json({ success: true, message: "Project rejected and returned to draft." });
    }
  } catch (err: any) {
    console.error("Error in admin review project endpoint:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
