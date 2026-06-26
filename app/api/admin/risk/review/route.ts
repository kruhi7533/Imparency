import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

// Actions: CLEAR | SUSPEND | ESCALATE
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { reviewId, action, reviewNote } = body;

  if (!reviewId || !action) {
    return NextResponse.json({ error: "reviewId and action are required" }, { status: 400 });
  }

  if (!reviewNote?.trim()) {
    return NextResponse.json({ error: "A review note is required before taking action." }, { status: 400 });
  }

  const review = await prisma.riskReview.findUnique({ where: { id: reviewId } });
  if (!review) {
    return NextResponse.json({ error: "Risk review not found" }, { status: 404 });
  }

  if (action === "SUSPEND") {
    // Admin manually suspends — human decision, not automated
    await prisma.nGOProfile.update({
      where: { id: review.ngoId },
      data: { isSuspended: true },
    });
  } else if (action === "CLEAR") {
    await prisma.nGOProfile.update({
      where: { id: review.ngoId },
      data: { isSuspended: false },
    });
  }
  // ESCALATE — note is recorded, no DB state change (handled externally)

  const updated = await prisma.riskReview.update({
    where: { id: reviewId },
    data: {
      status: action === "CLEAR" ? "CLEARED" : action === "SUSPEND" ? "SUSPENDED" : "REVIEWED",
      reviewedBy: session.user.id,
      reviewNote: reviewNote.trim(),
      resolvedAt: ["CLEAR", "SUSPEND"].includes(action) ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true, status: updated.status });
}
