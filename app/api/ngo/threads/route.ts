import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export const runtime = "nodejs";

/** Resolve the NGO profile id for the logged-in NGO user (owner or team member). */
async function resolveNgoId(session: any): Promise<string | null> {
  const profile = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  return profile?.id ?? session.user.ngoProfileId ?? null;
}

/** List this NGO's review threads (admin inquiries + own appeals). */
export async function GET() {
  const auth = await verifySessionRole(Role.NGO);
  if (!auth.authorized) return auth.response;

  try {
    const ngoId = await resolveNgoId(auth.session);
    if (!ngoId) {
      return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    }

    const threads = await prisma.reviewThread.findMany({
      where: { subjectType: "NGO", subjectId: ngoId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({ threads });
  } catch (err: any) {
    console.error("Error listing NGO threads:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}

/**
 * NGO opens an APPEAL thread — e.g. to contest a rejection or suspension.
 * Body: { subject: string, message: string }
 */
export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.NGO);
  if (!auth.authorized) return auth.response;

  try {
    const ngoId = await resolveNgoId(auth.session);
    if (!ngoId) {
      return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    }

    const body = await request.json();
    const subject: string = body.subject?.trim();
    const message: string = body.message?.trim();

    if (!subject || !message) {
      return NextResponse.json({ error: "Subject and message are required" }, { status: 400 });
    }

    // Basic abuse guard: max 3 open appeals at a time
    const openAppeals = await prisma.reviewThread.count({
      where: { subjectType: "NGO", subjectId: ngoId, kind: "APPEAL", status: { not: "RESOLVED" } },
    });
    if (openAppeals >= 3) {
      return NextResponse.json(
        { error: "You already have 3 open appeals. Please wait for a response before opening another." },
        { status: 429 }
      );
    }

    const thread = await prisma.reviewThread.create({
      data: {
        subjectType: "NGO",
        subjectId: ngoId,
        participantUserId: auth.session.user.id,
        kind: "APPEAL",
        subject: subject.slice(0, 200),
        entityType: "SUSPENSION",
        status: "NGO_RESPONDED", // needs admin attention from the start
        createdById: auth.session.user.id,
        messages: {
          create: {
            authorId: auth.session.user.id,
            authorRole: "NGO",
            body: message,
          },
        },
      },
    });

    return NextResponse.json({ success: true, threadId: thread.id });
  } catch (err: any) {
    console.error("Error creating appeal thread:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
