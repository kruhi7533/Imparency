import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export const runtime = "nodejs";

/** NGO replies to a thread. Ownership is enforced — you can only reply to your own NGO's threads. */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.NGO);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const message: string = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: auth.session.user.id },
      select: { id: true },
    });
    const ngoId = profile?.id ?? auth.session.user.ngoProfileId ?? null;
    if (!ngoId) {
      return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    }

    const thread = await prisma.reviewThread.findUnique({ where: { id: params.id } });
    if (!thread || thread.subjectType !== "NGO" || thread.subjectId !== ngoId) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if (thread.status === "RESOLVED") {
      return NextResponse.json(
        { error: "This thread has been resolved. Open a new appeal if you need further help." },
        { status: 409 }
      );
    }

    await prisma.reviewMessage.create({
      data: {
        threadId: thread.id,
        authorId: auth.session.user.id,
        authorRole: "NGO",
        body: message,
      },
    });

    await prisma.reviewThread.update({
      where: { id: thread.id },
      data: { status: "NGO_RESPONDED" },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Error replying to thread:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
