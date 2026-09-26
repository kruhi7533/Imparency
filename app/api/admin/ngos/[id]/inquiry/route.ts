import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { openNgoInquiryThread } from "@/lib/inquiry-thread";

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

    // Thread + notification + email live in one helper so the matching flow
    // cannot drift into a second, subtly different version of "tell an NGO".
    const threadId = await openNgoInquiryThread({
      ngoId: ngo.id,
      adminId,
      subject: threadSubject,
      body: questionText,
      entityType,
      entityId,
      request,
    });

    return NextResponse.json({ success: true, threadId });
  } catch (err: any) {
    console.error("Error in ngo inquiry endpoint:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
