import { NextResponse } from "next/server";
import { Role, ProposalStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";

export const runtime = "nodejs";

/**
 * Submit this organisation's proposal for an opportunity it was shortlisted
 * for.
 *
 * Being shortlisted is a PRECONDITION checked here, not a claim taken from the
 * caller: `verifySessionRole("NGO")` proves the caller is *an* NGO, never that
 * they are the one this opportunity is open to. The candidate lookup below is
 * scoped to the caller's own profile id for that reason — see the tenancy note
 * in CLAUDE.md.
 *
 * Kept deliberately thin. The organisation-facing UI for drafting a proposal
 * belongs to the NGO surface, not the admin one; this exists so a proposal can
 * reach the admin review queue at all.
 */
export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;

  let body: { opportunityId?: string; title?: string; summary?: string; requestedAmount?: unknown; plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const opportunityId = body.opportunityId?.trim();
  const title = body.title?.trim();
  const summary = body.summary?.trim();
  const amount = Number(body.requestedAmount);

  if (!opportunityId || !title || !summary) {
    return NextResponse.json(
      { error: "opportunityId, title and summary are required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "requestedAmount must be a positive number" }, { status: 400 });
  }

  try {
    const profile = await prisma.nGOProfile.findFirst({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!profile) {
      return NextResponse.json({ error: "No organisation profile for this account" }, { status: 403 });
    }

    const opportunity = await prisma.fundingOpportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true, status: true },
    });
    if (!opportunity) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }
    if (opportunity.status !== "OPEN") {
      return NextResponse.json(
        { error: "This opportunity is not open for proposals." },
        { status: 409 }
      );
    }

    // The gate. Scoped to this organisation's own id — an NGO cannot propose
    // against a shortlisting that belongs to someone else.
    const shortlisted = await prisma.matchCandidate.findFirst({
      where: {
        ngoId: profile.id,
        decision: "SHORTLISTED",
        job: { opportunityId },
      },
      select: { id: true },
    });
    if (!shortlisted) {
      return NextResponse.json(
        { error: "Your organisation has not been shortlisted for this opportunity." },
        { status: 403 }
      );
    }

    // One live proposal per organisation per opportunity: resubmitting edits
    // the existing one rather than forking a second competing document. A
    // decided proposal is never overwritten.
    const existing = await prisma.proposal.findUnique({
      where: { opportunityId_ngoId: { opportunityId, ngoId: profile.id } },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== ProposalStatus.DRAFT && existing.status !== ProposalStatus.SUBMITTED) {
      return NextResponse.json(
        { error: `This proposal is already ${existing.status.toLowerCase().replace(/_/g, " ")} and cannot be resubmitted.` },
        { status: 409 }
      );
    }

    const proposal = await prisma.proposal.upsert({
      where: { opportunityId_ngoId: { opportunityId, ngoId: profile.id } },
      create: {
        opportunityId,
        ngoId: profile.id,
        title,
        summary,
        requestedAmount: amount,
        plan: body.plan?.trim() || null,
        status: ProposalStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      update: {
        title,
        summary,
        requestedAmount: amount,
        plan: body.plan?.trim() || null,
        status: ProposalStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      select: { id: true, status: true },
    });

    return NextResponse.json(proposal, { status: existing ? 200 : 201 });
  } catch (err: any) {
    console.error("Failed to submit proposal:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
