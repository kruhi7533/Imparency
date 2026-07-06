import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id }
    });

    if (!profile) {
      return NextResponse.json({ error: 'NGO Profile not found' }, { status: 404 });
    }

    const drafts = await (prisma as any).draftProof.findMany({
      where: { ngoId: profile.id },
      orderBy: { createdAt: 'desc' },
      include: {
        fieldWorker: {
          select: {
            name: true,
            reliabilityScore: true
          }
        }
      }
    });

    return NextResponse.json({ drafts });
  } catch (error) {
    console.error('[Drafts GET] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
