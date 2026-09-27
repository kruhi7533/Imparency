import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const donorId = session.user.id;
    const ngoId = params.id;

    // Verify NGO profile exists
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
    });

    if (!ngo) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    // Check existing follow record
    const existingFollow = await prisma.nGOFollower.findUnique({
      where: {
        donorId_ngoId: {
          donorId,
          ngoId,
        },
      },
    });

    let followed = false;
    if (existingFollow) {
      // Unfollow
      await prisma.nGOFollower.delete({
        where: {
          donorId_ngoId: {
            donorId,
            ngoId,
          },
        },
      });
    } else {
      // Follow
      await prisma.nGOFollower.create({
        data: {
          donorId,
          ngoId,
        },
      });
      followed = true;
    }

    return NextResponse.json({ success: true, followed });
  } catch (err: any) {
    // P2003 = FK violation on donorId: the JWT carries a user id that no longer
    // exists in the DB (e.g. after a DB reset). Signing in again mints a fresh token.
    if (err?.code === "P2003") {
      return NextResponse.json(
        { error: "Your session is out of date. Please sign out and sign in again." },
        { status: 401 }
      );
    }
    console.error("Follow Toggle Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
