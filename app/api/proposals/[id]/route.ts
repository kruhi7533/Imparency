import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const proposal = await prisma.proposal.findUnique({
      where: { id: params.id },
      include: {
        opportunity: true
      }
    });

    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    
    // Map to frontend expected names
    return NextResponse.json({
      ...proposal,
      activities: proposal.plan,
      budget: proposal.requestedAmount,
      feedback: proposal.decisionNote
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "NGO" && session.user.role !== "DONOR")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const existing = await prisma.proposal.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Handle CSR requesting changes
    if (body.action === "REQUEST_CHANGE" && session.user.role === "DONOR") {
      const updated = await prisma.proposal.update({
        where: { id: params.id },
        data: {
          status: "CHANGE_REQUESTED",
          decisionNote: body.feedback,
        }
      });
      return NextResponse.json({
        ...updated,
        activities: updated.plan,
        budget: updated.requestedAmount,
        feedback: updated.decisionNote
      });
    }
    
    // Handle NGO submitting V2
    if (body.action === "SUBMIT_V2" && session.user.role === "NGO") {
      let history = Array.isArray(existing.history) ? existing.history : [];
      if (typeof existing.history === 'string') {
        try { history = JSON.parse(existing.history); } catch (e) { history = []; }
      }
      
      const newHistoryEntry = {
        version: existing.version,
        activities: existing.plan,
        budget: existing.requestedAmount,
        milestones: existing.milestones,
        feedback: existing.decisionNote,
        submittedAt: new Date().toISOString()
      };

      const updated = await prisma.proposal.update({
        where: { id: params.id },
        data: {
          plan: body.activities,
          requestedAmount: parseFloat(body.budget),
          milestones: body.milestones,
          status: "SUBMITTED",
          version: existing.version + 1,
          decisionNote: null,
          history: [...history, newHistoryEntry]
        }
      });
      return NextResponse.json({
        ...updated,
        activities: updated.plan,
        budget: updated.requestedAmount,
        feedback: updated.decisionNote
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update proposal" }, { status: 500 });
  }
}
