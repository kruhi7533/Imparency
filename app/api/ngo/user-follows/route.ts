import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ followedNGOIds: [] });
    }

    const follows = await prisma.nGOFollower.findMany({
      where: { donorId: session.user.id },
      select: { ngoId: true },
    });

    const followedNGOIds = follows.map((f) => f.ngoId);

    return NextResponse.json({ success: true, followedNGOIds });
  } catch (err: any) {
    console.error("User follows fetch error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
