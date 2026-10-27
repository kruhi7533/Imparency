import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNgoMembership, ngoCan } from "@/lib/tenant-scope";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "NGO") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { requirementId, activities, budget, milestones } = body;

    // Workstream E: membership (owner or team) with programme rights, not
    // just "an NGO account"; and the same shortlist gate as /api/ngo/proposals —
    // an NGO cannot drop a proposal into any funder's opportunity by id.
    const member = await getNgoMembership(session.user.id);
    if (!member) return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
    if (!ngoCan(member.teamRole, "manageProgramme")) {
      return NextResponse.json({ error: "Your role cannot submit proposals." }, { status: 403 });
    }
    const ngoProfile = { id: member.ngoId };
    if (typeof requirementId !== "string" || !requirementId) {
      return NextResponse.json({ error: "requirementId is required" }, { status: 400 });
    }
    const opportunity = await prisma.fundingOpportunity.findUnique({ where: { id: requirementId }, select: { status: true } });
    if (!opportunity || opportunity.status !== "OPEN") {
      return NextResponse.json({ error: "Opportunity not found or not open." }, { status: 404 });
    }
    const shortlisted = await prisma.matchCandidate.findFirst({
      where: { ngoId: ngoProfile.id, decision: "SHORTLISTED", job: { opportunityId: requirementId } },
      select: { id: true },
    });
    if (!shortlisted) {
      return NextResponse.json({ error: "Your organisation has not been shortlisted for this opportunity." }, { status: 403 });
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
