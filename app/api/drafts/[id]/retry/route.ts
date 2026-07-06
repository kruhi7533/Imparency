import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { processProofInBackground } from '@/lib/whatsapp/worker';

const prisma = new PrismaClient();

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;

    const draft = await prisma.draftProof.findUnique({
      where: { id },
      include: { ngo: true }
    });

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    if (draft.ngo.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (draft.workerStatus !== 'ENRICHMENT_FAILED') {
      return NextResponse.json({ error: 'Draft is not in a failed state' }, { status: 400 });
    }

    // Set workerStatus back to 'PENDING'
    await prisma.draftProof.update({
      where: { id },
      data: { workerStatus: 'PENDING' }
    });

    // Re-fire background worker
    processProofInBackground(draft.id, draft.ngoId).catch((err) => 
      console.error("[retry] background worker failed:", err)
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Draft Retry POST] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
