import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const proposal = await prisma.proposal.findUnique({
      where: { id: params.id },
      include: {
        opportunity: true,
        ngo: { select: { id: true, userId: true } },
      },
    });

    if (!proposal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const userId = session.user.id;
    const role = session.user.role;

    // Ownership check:
    // ADMIN can view all.
    // NGO can only view their own proposal (owner or team member).
    // DONOR can only view proposals submitted to their own opportunity.
    let isAllowed = role === "ADMIN";

    if (role === "NGO") {
      if (!proposal.ngo || proposal.ngo.userId === userId || proposal.ngoId === session.user.ngoProfileId) {
        isAllowed = true;
      } else {
        const isMember = await prisma.nGOTeamMember.findFirst({
          where: { userId, ngoId: proposal.ngoId },
        });
        if (isMember) isAllowed = true;
      }
    } else if (role === "DONOR") {
      if (!proposal.opportunity?.funderUserId || proposal.opportunity.funderUserId === userId) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden: You do not have access to this proposal" }, { status: 403 });
    }

    // Map to frontend expected names
    return NextResponse.json({
      ...proposal,
      activities: proposal.plan,
      budget: proposal.requestedAmount,
      feedback: proposal.decisionNote,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch proposal" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || (session.user.role !== "NGO" && session.user.role !== "DONOR")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const role = session.user.role;

    const existing = await prisma.proposal.findUnique({
      where: { id: params.id },
      include: {
        opportunity: true,
        ngo: { select: { id: true, userId: true } },
      },
    });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Prevent modifying finalized proposals
    if (existing.status === "APPROVED" || existing.status === "REJECTED") {
      return NextResponse.json({ error: "Cannot modify an approved or rejected proposal" }, { status: 400 });
    }

    const body = await req.json();

    // Handle CSR requesting changes
    if (body.action === "REQUEST_CHANGE" && role === "DONOR") {
      // Must be the funder who owns the opportunity if specified
      if (existing.opportunity?.funderUserId && existing.opportunity.funderUserId !== userId) {
        return NextResponse.json({ error: "Forbidden: You are not the funder for this opportunity" }, { status: 403 });
      }

      const updated = await prisma.proposal.update({
        where: { id: params.id },
        data: {
          status: "CHANGE_REQUESTED",
          decisionNote: body.feedback,
        },
      });
      return NextResponse.json({
        ...updated,
        activities: updated.plan,
        budget: updated.requestedAmount,
        feedback: updated.decisionNote,
      });
    }

    // Handle NGO submitting V2
    if (body.action === "SUBMIT_V2" && role === "NGO") {
      // Verify caller belongs to the proposal's NGO
      if (existing.ngo) {
        let isOwnerOrAdmin = existing.ngo.userId === userId || existing.ngoId === session.user.ngoProfileId;
        if (!isOwnerOrAdmin) {
          const membership = await prisma.nGOTeamMember.findFirst({
            where: { userId, ngoId: existing.ngoId, role: { in: ["OWNER", "ADMIN"] } },
          });
          if (membership) isOwnerOrAdmin = true;
        }

        if (!isOwnerOrAdmin) {
          return NextResponse.json({ error: "Forbidden: You do not have permission to edit this proposal" }, { status: 403 });
        }
      }

      let history = Array.isArray(existing.history) ? existing.history : [];
      if (typeof existing.history === "string") {
        try {
          history = JSON.parse(existing.history);
        } catch (e) {
          history = [];
        }
      }

      const newHistoryEntry = {
        version: existing.version,
        activities: existing.plan,
        budget: existing.requestedAmount,
        milestones: existing.milestones,
        feedback: existing.decisionNote,
        submittedAt: new Date().toISOString(),
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
          history: [...history, newHistoryEntry],
        },
      });
      return NextResponse.json({
        ...updated,
        activities: updated.plan,
        budget: updated.requestedAmount,
        feedback: updated.decisionNote,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update proposal" }, { status: 500 });
  }
}
