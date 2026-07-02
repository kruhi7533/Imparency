import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { sendProjectPublishedEmail, sendProjectRejectedEmail } from "@/lib/email";

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

    if (action === "APPROVE") {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: "ACTIVE",
          reviewNote: null,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
      });

      await prisma.projectReview.create({
        data: { projectId, adminId, action: "APPROVED" },
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

      await prisma.project.update({
        where: { id: projectId },
        data: {
          status: "DRAFT",
          reviewNote: reason,
          reviewedAt: new Date(),
          reviewedById: adminId,
        },
      });

      await prisma.projectReview.create({
        data: { projectId, adminId, action: "REJECTED", note: reason },
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
