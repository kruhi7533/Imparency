import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const rl = await checkRateLimit(request, "crisis/join", 10, 3600);
    if (rl.isBlocked) return rl.response;

    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id },
      select: { id: true, verificationStatus: true },
    });
    if (!profile) return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    if (profile.verificationStatus !== "VERIFIED") {
      return NextResponse.json({ error: "Only verified NGOs can join a relief effort" }, { status: 403 });
    }

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });
    if (event.status !== "ACTIVE") {
      return NextResponse.json({ error: "This crisis is not currently active" }, { status: 400 });
    }

    const existing = await prisma.crisisParticipant.findUnique({
      where: { crisisEventId_ngoId: { crisisEventId: event.id, ngoId: profile.id } },
    });
    if (existing) {
      return NextResponse.json({ error: "Your NGO has already joined this relief effort" }, { status: 409 });
    }

    const participant = await prisma.$transaction(async (tx) => {
      const p = await tx.crisisParticipant.create({
        data: { crisisEventId: event.id, ngoId: profile.id },
      });
      await tx.crisisEvent.update({
        where: { id: event.id },
        data: { totalNgos: { increment: 1 } },
      });
      return p;
    });

    return NextResponse.json({ participantId: participant.id, crisisEventId: event.id, joinedAt: participant.joinedAt }, { status: 201 });
  } catch (err: any) {
    // Unique constraint race — two simultaneous join requests from the same NGO.
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Your NGO has already joined this relief effort" }, { status: 409 });
    }
    console.error("Crisis join error:", err);
    return NextResponse.json({ error: "We couldn't process this right now. Please try again." }, { status: 500 });
  }
}
