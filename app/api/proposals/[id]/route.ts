import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNgoMembership, ngoCan, redactForDonor } from "@/lib/tenant-scope";
import { checkDonorAction } from "@/lib/donor-team";

/**
 * Tenant rules (Workstream E, NEG-001/002): an NGO reaches a proposal only
 * through a live membership of the proposing NGO (never the JWT's
 * ngoProfileId, which can be stale); a donor only when its ACCOUNT
 * (lib/donor-team.ts) is the opportunity's funder — an opportunity with no
 * funder is platform-run and no donor sees its proposals. Donors get the
 * proposal without reviewer ids / internal fields.
 */

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
      isAllowed = !!(await getNgoMembership(userId, proposal.ngoId));
    } else if (role === "DONOR") {
      const funder = proposal.opportunity?.funderUserId;
      isAllowed = !!funder && (await checkDonorAction(userId, funder, "view")).ok;
    }

    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden: You do not have access to this proposal" }, { status: 403 });
    }

    // Map to frontend expected names
    const body = {
      ...proposal,
      activities: proposal.plan,
      budget: proposal.requestedAmount,
      feedback: proposal.decisionNote,
    };
    return NextResponse.json(role === "DONOR" ? redactForDonor(body, ["userId"]) : body);
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
      // Must act for the funder account, with the "decide" capability.
      const funder = existing.opportunity?.funderUserId;
      const check = funder ? await checkDonorAction(userId, funder, "decide") : { ok: false as const, reason: "not_party" as const };
      if (!check.ok) {
        return NextResponse.json(
          { error: check.reason === "role" ? "Your role cannot request changes." : "Forbidden: You are not the funder for this opportunity" },
          { status: 403 }
        );
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
      const member = await getNgoMembership(userId, existing.ngoId);
      if (!member || !ngoCan(member.teamRole, "manageProgramme")) {
        return NextResponse.json({ error: "Forbidden: You do not have permission to edit this proposal" }, { status: 403 });
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
