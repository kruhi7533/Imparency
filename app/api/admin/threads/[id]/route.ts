import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * Admin acts on a review thread: reply (adds a message, reopens the thread)
 * and/or resolve (closes it). Body: { message?: string, resolve?: boolean }
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const message: string | undefined = body.message?.trim() || undefined;
    const resolve: boolean = body.resolve === true;

    if (!message && !resolve) {
      return NextResponse.json(
        { error: "Provide a message, resolve: true, or both" },
        { status: 400 }
      );
    }

    const thread = await prisma.reviewThread.findUnique({
      where: { id: params.id },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const adminId = auth.session.user.id;

    if (message) {
      await prisma.reviewMessage.create({
        data: {
          threadId: thread.id,
          authorId: adminId,
          authorRole: "ADMIN",
          body: message,
        },
      });

      // Notify the participant (NGO owner or donor) of the admin's reply
      await prisma.notification.create({
        data: {
          userId: thread.participantUserId,
          type: "ADMIN_INQUIRY_REPLY",
          title: "Admin replied to your thread",
          body: `"${thread.subject}": ${message.slice(0, 180)}${message.length > 180 ? "…" : ""}`,
        },
      });
    }

    const newStatus = resolve ? "RESOLVED" : "OPEN";
    await prisma.reviewThread.update({
      where: { id: thread.id },
      data: { status: newStatus },
    });

    await logAdminAction({
      adminId,
      action: resolve ? "THREAD_RESOLVED" : "THREAD_REPLIED",
      entityType: "THREAD",
      entityId: thread.id,
      oldValue: { status: thread.status },
      newValue: { status: newStatus },
      note: message ?? null,
      metadata: { subjectType: thread.subjectType, subjectId: thread.subjectId, kind: thread.kind },
      request,
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err: any) {
    console.error("Error updating review thread:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
