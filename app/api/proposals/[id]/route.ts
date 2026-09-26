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
        sponsorRequirement: true
      }
    });

    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(proposal);
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
          feedback: body.feedback,
        }
      });
      return NextResponse.json(updated);
    }
    
    // Handle NGO submitting V2
    if (body.action === "SUBMIT_V2" && session.user.role === "NGO") {
      let history = Array.isArray(existing.history) ? existing.history : [];
      if (typeof existing.history === 'string') {
        try { history = JSON.parse(existing.history); } catch (e) { history = []; }
      }
      
      const newHistoryEntry = {
        version: existing.version,
        activities: existing.activities,
        budget: existing.budget,
        milestones: existing.milestones,
        feedback: existing.feedback,
        submittedAt: new Date().toISOString()
      };

      const updated = await prisma.proposal.update({
        where: { id: params.id },
        data: {
          activities: body.activities,
          budget: parseFloat(body.budget),
          milestones: body.milestones,
          status: "SUBMITTED",
          version: existing.version + 1,
          feedback: null,
          history: [...history, newHistoryEntry]
        }
      });
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update proposal" }, { status: 500 });
  }
}
