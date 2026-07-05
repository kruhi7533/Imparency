import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { sendAdminInquiryEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * Admin opens a direct inquiry thread with any NGO, from wherever the NGO
 * appears in the console (verification, project review, FCRA, risk, impact
 * health). Milestone-proof questions keep their dedicated ask-ngo endpoint;
 * everything else goes through here. Threads land in the shared Inquiries
 * inbox on both sides.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  const rl = await checkRateLimit(request, "admin/ngo-inquiry", 30, 60);
  if (rl.isBlocked) return rl.response!;

  try {
    const body = await request.json();
    const { question, subject, entityType, entityId } = body;

    if (!question?.trim()) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: params.id },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!ngo) {
      return NextResponse.json({ error: "NGO not found" }, { status: 404 });
    }

    const adminId = auth.session.user.id;
    const questionText = question.trim();
    const threadSubject = subject?.trim() || `Question for "${ngo.orgName}"`;

    const thread = await prisma.reviewThread.create({
      data: {
        subjectType: "NGO",
        subjectId: ngo.id,
        participantUserId: ngo.user.id,
        kind: "INQUIRY",
        subject: threadSubject,
        entityType: entityType || null,
        entityId: entityId || null,
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

    await prisma.notification.create({
      data: {
        userId: ngo.user.id,
        type: "ADMIN_INQUIRY",
        title: "Admin has a question for your organisation",
        body: `${threadSubject}: ${questionText.slice(0, 180)}${questionText.length > 180 ? "…" : ""} — reply from your dashboard inquiries page.`,
      },
    });

    await logAdminAction({
      adminId,
      action: "NGO_INQUIRY_SENT",
      entityType: "THREAD",
      entityId: thread.id,
      note: questionText,
      metadata: { subjectType: "NGO", subjectId: ngo.id, entityType, entityId },
      request,
    });

    // Email is best-effort — the thread is the source of truth.
    try {
      await sendAdminInquiryEmail(ngo.user.email, ngo.orgName, threadSubject, questionText);
    } catch (emailErr) {
      console.error("ngo-inquiry email failed (thread still created):", emailErr);
    }

    return NextResponse.json({ success: true, threadId: thread.id });
  } catch (err: any) {
    console.error("Error in ngo inquiry endpoint:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
