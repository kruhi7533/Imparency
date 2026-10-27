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
    const status = body.status;
    const rejectionReason = body.rejectionReason || body.reason;

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
      const d: any = await tx.draftProof.update({
        where: { id },
        data: { status: status as any, riskReason: status === 'REJECTED' ? rejectionReason : draft.riskReason },
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

      // ADDITION 2 — Milestone proof submission trigger (guarded against cross-tenant milestone modification)
      if (status === 'APPROVED' && draft.predictedMilestoneId) {
        const milestone = await tx.milestone.findUnique({
          where: { id: draft.predictedMilestoneId },
          include: { project: { select: { ngoId: true } } },
        });

        // Strictly verify that the AI-predicted milestone belongs to this NGO's own project
        if (milestone && milestone.project.ngoId === draft.ngoId) {
          // Create the official MilestoneProof record so admin review queue is populated
          await tx.milestoneProof.create({
            data: {
              milestoneId: milestone.id,
              submittedById: session.user.id,
              description: draft.aiSummary || draft.rawMessage || "Verified WhatsApp Field Submission",
              mediaUrls: draft.persistentPhotoUrls?.length ? draft.persistentPhotoUrls : draft.mediaUrls,
              documentUrls: [],
              theoryOfChangeAlignmentScore: 100,
              theoryOfChangeReasoning: "Field report verified and approved by NGO administrator",
            },
          });

          // Mark milestone as having proof submitted
          await tx.milestone.update({
            where: { id: milestone.id },
            data: {
              status: 'PROOF_SUBMITTED',
            },
          });
          console.log(`[approval] MilestoneProof created and milestone ${milestone.id} marked as PROOF_SUBMITTED`);
        } else if (milestone) {
          console.warn(`[security] AI predicted milestone ${draft.predictedMilestoneId} belongs to NGO ${milestone.project.ngoId}, not draft NGO ${draft.ngoId}. Milestone update blocked.`);
        }
      }

      return d;
    });

    // ADDITION 1 — WhatsApp reply loop
    const worker = (updatedDraft as any)?.fieldWorker;
    if (worker) {
      const milestoneLabel = updatedDraft.predictedMilestoneId 
        ? (await prisma.milestone.findUnique({ where: { id: updatedDraft.predictedMilestoneId } }))?.title ?? 'your recent submission'
        : 'your recent submission';

      const messageBody = status === 'APPROVED'
        ? `✅ Approved: Your report on "${milestoneLabel}" has been reviewed and approved. Thank you!`
        : `❌ Rejected: Your report on "${milestoneLabel}" was not approved. Reason: ${rejectionReason ?? 'No reason provided'}. Please resubmit with corrections.`;

      // Fire-and-forget
      twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${worker.phone}`,
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
