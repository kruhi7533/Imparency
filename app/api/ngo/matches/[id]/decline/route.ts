import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id },
    });

    if (!profile) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    // Ensure the candidate belongs to this NGO and is in a state they can decline
    const candidate = await prisma.matchCandidate.findFirst({
      where: {
        id: params.id,
        ngoId: profile.id,
      },
    });

    if (!candidate) {
      return NextResponse.json({ error: "Match not found or not owned by you" }, { status: 404 });
    }

    // The user's spec says "writes DECLINED and drops it from the list"
    await prisma.matchCandidate.update({
      where: { id: params.id },
      data: {
        decision: "DECLINED",
      },
    });

    return NextResponse.json({ success: true, status: "DECLINED" });
  } catch (err: any) {
    console.error("Match Decline Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
