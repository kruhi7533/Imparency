import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "NGO") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { requirementId, activities, budget, milestones } = body;

    const ngoProfile = await prisma.nGOProfile.findUnique({
      where: { userId: session.user.id }
    });

    if (!ngoProfile) {
      return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    }

    const proposal = await prisma.proposal.create({
      data: {
        opportunityId: requirementId,
        ngoId: ngoProfile.id,
        title: "Proposal for Opportunity",
        summary: "Proposal summary",
        plan: activities,
        requestedAmount: parseFloat(budget),
        milestones: milestones,
        status: "SUBMITTED",
        submittedAt: new Date(),
        version: 1,
        history: "[]",
      }
    });

    return NextResponse.json(proposal);
  } catch (error) {
    console.error("Proposal creation error:", error);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}
