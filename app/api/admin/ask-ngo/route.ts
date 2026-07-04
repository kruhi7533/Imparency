import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { sendProofQuestionEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * Admin asks the NGO a clarification question about a milestone proof.
 *
 * Previously one-way (email only). Now every question opens a ReviewThread so
 * the NGO can reply in-app and the whole exchange stays attached to the
 * milestone instead of fragmenting into inboxes.
 */
export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  const rl = await checkRateLimit(request, "admin/ask-ngo", 30, 60);
  if (rl.isBlocked) return rl.response!;

  try {
    const body = await request.json();
    const { milestoneId, question } = body;

    if (!milestoneId || !question?.trim()) {
      return NextResponse.json(
        { error: "Milestone ID and question are required" },
        { status: 400 }
      );
    }

    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        project: {
          include: {
            ngo: {
              include: {
                user: { select: { id: true, email: true } },
              },
            },
          },
        },
      },
    });

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const adminId = auth.session.user.id;
    const ngo = milestone.project.ngo;
    const questionText = question.trim();

    // Create the thread + first message
    const thread = await prisma.reviewThread.create({
      data: {
        subjectType: "NGO",
        subjectId: ngo.id,
        participantUserId: ngo.user.id,
        kind: "INQUIRY",
        subject: `Question about milestone "${milestone.title}"`,
        entityType: "MILESTONE",
        entityId: milestoneId,
        status: "OPEN",
        createdById: adminId,
        messages: {
          create: {
            authorId: adminId,
            authorRole: "ADMIN",
            body: questionText,
          },
        },
      },
    });

    // In-app notification so the NGO sees it without checking email
    await prisma.notification.create({
      data: {
        userId: ngo.user.id,
        type: "ADMIN_INQUIRY",
        title: "Admin has a question about your milestone proof",
        body: `Regarding "${milestone.title}": ${questionText.slice(0, 180)}${questionText.length > 180 ? "…" : ""} — reply from your dashboard inquiries page.`,
      },
    });

    await logAdminAction({
      adminId,
      action: "NGO_INQUIRY_SENT",
      entityType: "THREAD",
      entityId: thread.id,
      note: questionText,
      metadata: { subjectType: "NGO", subjectId: ngo.id, milestoneId },
      request,
    });

    // Email still goes out (best-effort — the thread is the source of truth now)
    try {
      await sendProofQuestionEmail(ngo.user.email, ngo.orgName, milestone.title, questionText);
    } catch (emailErr) {
      console.error("ask-ngo email failed (thread still created):", emailErr);
    }

    return NextResponse.json({ success: true, threadId: thread.id });
  } catch (err: any) {
    console.error("Error in ask-ngo endpoint:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
