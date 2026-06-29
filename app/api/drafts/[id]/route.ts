import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import twilio from 'twilio';

const prisma = new PrismaClient();

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function GET(
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
      include: {
        fieldWorker: true,
        ngo: true
      }
    });

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    if (draft.ngo.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Include the predicted milestone name if available
    let predictedMilestoneName = null;
    if (draft.predictedMilestoneId) {
      const milestone = await prisma.milestone.findUnique({
        where: { id: draft.predictedMilestoneId },
        select: { title: true }
      });
      if (milestone) {
        predictedMilestoneName = milestone.title;
      }
    }

    return NextResponse.json({
      draft: {
        ...draft,
        predictedMilestoneName
      }
    });
  } catch (error) {
    console.error('[Draft GET] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;
    const body = await request.json();
    const { status, rejectionReason } = body;

    if (status !== 'APPROVED' && status !== 'REJECTED') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const draft = await prisma.draftProof.findUnique({
      where: { id },
      include: { 
        fieldWorker: true,
        ngo: true 
      }
    });

    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    if (draft.ngo.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (draft.status !== 'PENDING_REVIEW') {
      return NextResponse.json({ error: 'Draft already processed' }, { status: 400 });
    }

    const updatedDraft = await prisma.$transaction(async (tx) => {
      // 1. Update draft status
      const d = await tx.draftProof.update({
        where: { id },
        data: { status },
        include: { fieldWorker: true }
      });

      // 2. Update FieldWorker stats and reliability score
      if (draft.fieldWorkerId && draft.fieldWorker) {
        let { approvedCount, rejectedCount } = draft.fieldWorker;
        
        if (status === 'APPROVED') {
          approvedCount += 1;
        } else {
          rejectedCount += 1;
        }

        const actioned = approvedCount + rejectedCount;
        let newScore = draft.fieldWorker.reliabilityScore;
        
        // Recalculate reliabilityScore if actioned >= 3
        if (actioned >= 3) {
          newScore = Math.round((approvedCount / actioned) * 100);
          // Clamp between 0 and 100
          newScore = Math.max(0, Math.min(100, newScore));
        }

        await tx.fieldWorker.update({
          where: { id: draft.fieldWorkerId },
          data: {
            approvedCount,
            rejectedCount,
            reliabilityScore: newScore
          }
        });

        // re-fetch the updated worker for the response
        d.fieldWorker = await tx.fieldWorker.findUnique({ where: { id: draft.fieldWorkerId } });
      }

      // ADDITION 2 — Milestone auto-completion trigger
      if (status === 'APPROVED' && draft.predictedMilestoneId) {
        // Count approved proofs for this milestone
        const approvedProofCount = await tx.draftProof.count({
          where: {
            predictedMilestoneId: draft.predictedMilestoneId,
            status: 'APPROVED'
          }
        });
        
        const milestone = await tx.milestone.findUnique({
          where: { id: draft.predictedMilestoneId }
        });
        
        // Auto-complete if required proof threshold met
        // Using a hardcoded 1 here since requiredProofs does not exist in schema
        const REQUIRED_PROOFS = 1; 
        if (milestone && approvedProofCount >= REQUIRED_PROOFS) {
          await tx.milestone.update({
            where: { id: draft.predictedMilestoneId },
            data: {
              status: 'PROOF_SUBMITTED',
              // Note: completedAt doesn't exist on Milestone model in schema, so we omit it
            }
          });
          console.log(`[approval] Milestone ${draft.predictedMilestoneId} auto-completed`);
        }
      }

      return d;
    });

    // ADDITION 1 — WhatsApp reply loop
    if (updatedDraft.fieldWorker) {
      const milestoneLabel = updatedDraft.predictedMilestoneId 
        ? (await prisma.milestone.findUnique({ where: { id: updatedDraft.predictedMilestoneId } }))?.title ?? 'your recent submission'
        : 'your recent submission';

      const messageBody = status === 'APPROVED'
        ? `✅ Approved: Your report on "${milestoneLabel}" has been reviewed and approved. Thank you!`
        : `❌ Rejected: Your report on "${milestoneLabel}" was not approved. Reason: ${rejectionReason ?? 'No reason provided'}. Please resubmit with corrections.`;

      // Fire-and-forget
      twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${updatedDraft.fieldWorker.phone}`,
        body: messageBody
      }).catch(err => console.error('[approval] WhatsApp reply failed:', err));
    }

    return NextResponse.json({ draft: updatedDraft, success: true });
  } catch (error) {
    console.error('[Draft PATCH] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = params;

    // Verify the draft belongs to this NGO
    const profile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id }
    });

    if (!profile) {
      return NextResponse.json({ error: 'NGO Profile not found' }, { status: 404 });
    }

    const draft = await prisma.draftProof.findUnique({ where: { id } });

    if (!draft || draft.ngoId !== profile.id) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    await prisma.draftProof.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Draft DELETE] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
