import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import {
  isOutcomeAction,
  isAdminOnly,
  canApply,
  requiresNote,
  explainRefusal,
  OUTCOME_TRANSITIONS,
} from "@/lib/outcome-workflow";

/**
 * PATCH /api/ngo/outcome-claims/[id] — the organisation's own two actions:
 * SUBMIT a draft for review, or WITHDRAW a claim it should not have made.
 *
 * APPROVE / REJECT / REQUEST_EVIDENCE are refused here even for a correctly
 * authenticated NGO. The guard is explicit rather than implied by the route's
 * path, because "the NGO route only gets NGO sessions" is an authentication
 * fact and "an NGO may not approve its own number" is an authorisation one —
 * conflating them is how a self-approval hole gets opened by a later refactor.
 */
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole("NGO");
  if (!authorized) return response;

  const profile = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return NextResponse.json({ error: "NGO profile not found." }, { status: 404 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Narrow a bound variable, not `body?.action`: re-reading an `any` property
  // after the guard throws the narrowing away.
  const requested: unknown = body?.action;
  if (!isOutcomeAction(requested)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  const action = requested;

  if (isAdminOnly(action)) {
    return NextResponse.json(
      { error: "An organisation cannot decide its own claim. Only an administrator can." },
      { status: 403 }
    );
  }

  const claim = await prisma.outcomeClaim.findUnique({
    where: { id: params.id },
    select: { id: true, ngoId: true, status: true, citations: { select: { id: true } } },
  });
  // 404 rather than 403 for another organisation's claim: the existence of a
  // claim id is itself information.
  if (!claim || claim.ngoId !== profile.id) {
    return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  }

  if (!canApply(action, claim.status)) {
    return NextResponse.json({ error: explainRefusal(action, claim.status) }, { status: 409 });
  }

  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (requiresNote(action) && note.length < 10) {
    return NextResponse.json(
      { error: "Withdrawing a claim needs a reason of at least 10 characters." },
      { status: 400 }
    );
  }

  // Submitting a number with nothing behind it wastes a reviewer's time and
  // would be BLOCKED by triage anyway. Refusing here makes the queue mean
  // "someone asserted something checkable".
  if (action === "SUBMIT" && claim.citations.length === 0) {
    return NextResponse.json(
      { error: "Cite at least one piece of evidence before submitting this claim." },
      { status: 400 }
    );
  }

  const to = OUTCOME_TRANSITIONS[action].to;

  // Compare-and-swap. The `status` in the where clause is what makes a double
  // click, or a submit racing an admin's decision, lose instead of overwrite.
  const { count } = await prisma.outcomeClaim.updateMany({
    where: { id: claim.id, status: claim.status },
    data: {
      status: to,
      ...(action === "SUBMIT"
        ? { submittedById: session.user.id, submittedAt: new Date() }
        : { decisionNote: note }),
    },
  });

  if (count === 0) {
    return NextResponse.json(
      { error: "This claim changed while you were working on it. Reload and try again." },
      { status: 409 }
    );
  }

  return NextResponse.json({ claim: { id: claim.id, status: to } });
}
