import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { authorized, response, session } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  const body = await req.json();
  const { ngoId, riskLevel, findings } = body;

  if (!ngoId || !riskLevel) {
    return NextResponse.json({ error: "ngoId and riskLevel are required" }, { status: 400 });
  }

  const ngo = await prisma.nGOProfile.findUnique({ where: { id: ngoId } });
  if (!ngo) return NextResponse.json({ error: "NGO not found" }, { status: 404 });

  // Avoid duplicate open reviews
  const existing = await prisma.riskReview.findFirst({
    where: { ngoId, status: "OPEN" },
  });
  if (existing) {
    return NextResponse.json({ error: "An open risk review already exists for this NGO." }, { status: 409 });
  }

  const review = await prisma.riskReview.create({
    data: {
      ngoId,
      alertIds: [],
      riskLevel,
      findings: findings ?? null,
      status: "OPEN",
      reviewedBy: session.user.id,
    },
  });

  return NextResponse.json({ ok: true, reviewId: review.id });
}
