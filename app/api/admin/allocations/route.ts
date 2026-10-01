import { NextResponse } from "next/server";
import { Prisma, Role, AllocationStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkAllocation, committedTotal } from "@/lib/allocation";
import { isUniqueConstraintError } from "@/lib/razorpay-webhook";

export const runtime = "nodejs";

/**
 * ADMIN-only. Propose committing money to an approved proposal.
 *
 * This creates a PENDING allocation — an admin's stated intent. It commits
 * nothing on its own; a second decision (PATCH …/[id]) approves it. The two
 * steps exist so that "we intend to fund this" and "we have committed to fund
 * this" are different, recorded facts, and so four-eyes can be switched on
 * later without changing the shape of anything.
 *
 * A PENDING allocation still consumes budget — see committedTotal. Otherwise
 * two drafts against the same remaining amount would both pass their checks
 * and the conflict would only surface after both organisations had been told.
 */
export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  const adminId = session.user.id;

  let body: { proposalId?: unknown; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.proposalId !== "string" || !body.proposalId) {
    return NextResponse.json({ error: "proposalId is required" }, { status: 400 });
  }

  // Accepted as a string as well as a number: a rupee amount typed into a form
  // must not be routed through a float on its way here.
  const rawAmount = body.amount;
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") {
    return NextResponse.json({ error: "amount is required" }, { status: 400 });
  }
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(rawAmount.toString());
  } catch {
    return NextResponse.json({ error: "amount is not a number" }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({
    where: { id: body.proposalId },
    select: {
      id: true,
      status: true,
      ngoId: true,
      opportunityId: true,
      requestedAmount: true,
      allocation: { select: { id: true } },
      opportunity: { select: { id: true, amount: true } },
    },
  });

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const siblings = await prisma.allocation.findMany({
    where: { opportunityId: proposal.opportunityId },
    select: { status: true, amount: true },
  });

  const check = checkAllocation({
    proposalStatus: proposal.status,
    hasAllocation: Boolean(proposal.allocation),
    budget: proposal.opportunity.amount,
    committed: committedTotal(siblings),
    amount,
    requested: proposal.requestedAmount,
  });

  if (!check.ok) {
    return NextResponse.json(
      { error: check.message, refusal: check.refusal },
      // 409, not 400: the request is well formed, the world is not in a state
      // where it can be honoured.
      { status: check.refusal === "AMOUNT_NOT_POSITIVE" ? 400 : 409 },
    );
  }

  let allocation;
  try {
    allocation = await prisma.allocation.create({
      data: {
        proposalId: proposal.id,
        opportunityId: proposal.opportunityId,
        ngoId: proposal.ngoId,
        amount,
        proposedById: adminId,
      },
      select: { id: true },
    });
  } catch (err) {
    // Another admin proposed one for this proposal between the check and the
    // write. The unique index on proposalId is what actually prevents
    // double-funding; the check above is only the friendly version.
    if (isUniqueConstraintError(err)) {
      return NextResponse.json(
        { error: "This proposal already has an allocation.", refusal: "ALREADY_ALLOCATED" },
        { status: 409 },
      );
    }
    throw err;
  }

  await logAdminAction({
    adminId,
    action: "ALLOCATION_PROPOSED",
    entityType: "ALLOCATION",
    entityId: allocation.id,
    newValue: { status: AllocationStatus.PENDING, amount: amount.toFixed(2) },
    metadata: { proposalId: proposal.id, opportunityId: proposal.opportunityId },
    request,
  });

  return NextResponse.json({ id: allocation.id }, { status: 201 });
}
