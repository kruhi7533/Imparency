import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { draftId, milestoneId } = body;

    if (!draftId || !milestoneId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id },
    });

    if (!profile) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    const draft = await prisma.draftProof.findUnique({
      where: { id: draftId },
    });

    if (!draft || draft.ngoId !== profile.id || draft.status !== "PENDING_REVIEW") {
      return NextResponse.json({ error: "Draft not found or already processed" }, { status: 404 });
    }

    // Move to Milestone Proof
    const proof = await prisma.milestoneProof.create({
      data: {
        milestoneId,
        submittedById: session.user.id,
        description: draft.aiSummary || draft.rawMessage || "Imported from WhatsApp Field Update",
        mediaUrls: draft.persistentPhotoUrls.length ? draft.persistentPhotoUrls : draft.mediaUrls,
      },
    });

    // Update milestone status
    await prisma.milestone.update({
      where: { id: milestoneId },
      data: { status: "PROOF_SUBMITTED" },
    });

    // Mark draft as processed
    await prisma.draftProof.update({
      where: { id: draftId },
      data: { status: "APPROVED" },
    });

    return NextResponse.json({ success: true, proofId: proof.id });
  } catch (error) {
    console.error("WhatsApp Convert Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
