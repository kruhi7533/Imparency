import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkFunderEligibility } from "@/lib/matching/funder";
import {
  validateCriteria,
  parseAmount,
  type CriterionBody,
  type CriterionRow,
} from "@/lib/matching/validate-criteria";

export const runtime = "nodejs";

/**
 * ADMIN-only. Move a funding opportunity through its lifecycle, or revise it.
 *
 *   DRAFT     ──approve──▶ OPEN ──close──▶ CLOSED     (admin wrote it)
 *   SUBMITTED ──approve──▶ OPEN                       (a donor proposed it)
 *             ──reject───▶ REJECTED
 *
 * OPEN is the gate that matters: it is the point at which the engine will start
 * matching organisations against this opportunity, and therefore the point at
 * which an NGO can be told a funder is interested. Everything checked below is
 * checked here rather than at creation for that reason — a draft can be
 * incomplete, an open opportunity cannot.
 *
 * Every transition is a compare-and-swap, so two admins acting at once cannot
 * both succeed and the loser gets a 409 instead of a silent overwrite.
 *
 * A body carrying `action` moves status. A body carrying `title` /
 * `description` / `amount` / `criteria` instead REVISES the opportunity — this
 * is what closes the loop when a donor says a shortlist "isn't what I want":
 * an admin edits the criteria here, then presses Run (or Requeue) on the
 * existing job page, and the engine re-matches against what changed. No new
 * job semantics were needed for that — runMatchingJob already re-reads
 * OpportunityCriterion fresh on every run; it simply never had anything new to
 * read until this route could write to it after creation.
 */

const ACTIONS = ["APPROVE", "REJECT", "CLOSE"] as const;
type Action = (typeof ACTIONS)[number];

/** Which statuses each action may legally move out of. */
const LEGAL_FROM: Record<Action, string[]> = {
  APPROVE: ["DRAFT", "SUBMITTED"],
  REJECT: ["DRAFT", "SUBMITTED"],
  CLOSE: ["OPEN"],
};

const TO: Record<Action, string> = {
  APPROVE: "OPEN",
  REJECT: "REJECTED",
  CLOSE: "CLOSED",
};

/** Statuses with nothing left to revise — the opportunity is finished. */
const TERMINAL_STATUSES = ["CLOSED", "REJECTED"];

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const body = await request.json();

    if (typeof body.action !== "string") {
      return handleRevise(request, params.id, adminId, body);
    }

    // "OPEN" is still accepted so the existing button keeps working.
    const raw = body.action === "OPEN" ? "APPROVE" : body.action;
    if (!ACTIONS.includes(raw)) {
      return NextResponse.json(
        { error: `action must be one of ${ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }
    const action = raw as Action;
    const note = typeof body.note === "string" ? body.note.trim() : "";

    if (action === "REJECT" && !note) {
      return NextResponse.json(
        { error: "Say why this opportunity is being rejected — the donor will be told." },
        { status: 400 }
      );
    }

    const opportunity = await prisma.fundingOpportunity.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        funderUserId: true,
        _count: { select: { criteria: true } },
      },
    });
    if (!opportunity) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    if (!LEGAL_FROM[action].includes(opportunity.status)) {
      return NextResponse.json(
        { error: `Cannot ${action.toLowerCase()} an opportunity that is ${opportunity.status.toLowerCase()}.` },
        { status: 409 }
      );
    }

    if (action === "APPROVE") {
      // Without criteria the engine returns every organisation on the platform.
      if (opportunity._count.criteria === 0) {
        return NextResponse.json(
          { error: "Add at least one criterion before opening this opportunity." },
          { status: 400 }
        );
      }

      // The trust gate. An opportunity that reaches OPEN can put an NGO in
      // front of whoever is behind it, so that party must be a real, verified
      // donor — not a name in a text box.
      if (!opportunity.funderUserId) {
        return NextResponse.json(
          {
            error:
              "Link a verified funder account before opening this. Without one there is no " +
              "checked identity behind the money, and organisations would be approached on " +
              "the strength of a name alone.",
          },
          { status: 400 }
        );
      }
      const check = await checkFunderEligibility(opportunity.funderUserId);
      if (!check.ok) {
        return NextResponse.json({ error: check.message }, { status: 400 });
      }
    }

    const from = opportunity.status;
    const to = TO[action];

    const { count } = await prisma.fundingOpportunity.updateMany({
      where: { id: params.id, status: from },
      data: { status: to },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "This opportunity changed status while you were acting on it. Refresh and try again." },
        { status: 409 }
      );
    }

    await logAdminAction({
      adminId,
      action:
        action === "APPROVE"
          ? "OPPORTUNITY_OPENED"
          : action === "REJECT"
            ? "OPPORTUNITY_REJECTED"
            : "OPPORTUNITY_CLOSED",
      entityType: "OPPORTUNITY",
      entityId: params.id,
      oldValue: { status: from },
      newValue: { status: to },
      note: note || null,
      request,
    });

    return NextResponse.json({ id: params.id, status: to });
  } catch (err: any) {
    console.error("Failed to update opportunity:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}

/**
 * Edit title / description / amount / criteria on an opportunity that has not
 * finished its lifecycle yet. Everything is optional — send only what changed.
 *
 * Criteria, when sent, REPLACE the full set rather than patching individual
 * rows: partial criteria edits invite exactly the kind of half-updated state
 * this codebase avoids elsewhere (see the validate-then-write discipline in
 * the create route). The client always sends the complete list it is showing.
 *
 * Deliberately does not touch existing MatchingJob rows or their
 * criteriaSnapshot — those are a frozen record of what a past run actually
 * judged against, and must keep disagreeing with the live criteria after an
 * edit. That disagreement is the point: it is what "criteria this run
 * evaluated" on the job page is for.
 */
async function handleRevise(
  request: Request,
  opportunityId: string,
  adminId: string,
  body: {
    title?: unknown;
    description?: unknown;
    amount?: unknown;
    criteria?: CriterionBody[];
  }
): Promise<NextResponse> {
  const opportunity = await prisma.fundingOpportunity.findUnique({
    where: { id: opportunityId },
    select: {
      id: true,
      status: true,
      title: true,
      description: true,
      amount: true,
      criteria: {
        select: { kind: true, value: true, values: true, required: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }
  if (TERMINAL_STATUSES.includes(opportunity.status)) {
    return NextResponse.json(
      { error: `This opportunity is ${opportunity.status.toLowerCase()} and has nothing left to revise.` },
      { status: 409 }
    );
  }

  const data: { title?: string; description?: string; amount?: string | null } = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
    }
    data.title = title;
  }

  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() : "";
  }

  if (body.amount !== undefined) {
    const amountResult = parseAmount(body.amount);
    if (!amountResult.ok) {
      return NextResponse.json({ error: amountResult.error }, { status: 400 });
    }
    data.amount = amountResult.amount;
  }

  let criteriaRows: CriterionRow[] = [];
  let revisingCriteria = false;
  if (body.criteria !== undefined) {
    revisingCriteria = true;
    if (!Array.isArray(body.criteria)) {
      return NextResponse.json({ error: "criteria must be an array." }, { status: 400 });
    }
    const result = validateCriteria(body.criteria);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    criteriaRows = result.rows;
  }

  if (Object.keys(data).length === 0 && !revisingCriteria) {
    return NextResponse.json(
      { error: "Nothing to revise — send title, description, amount and/or criteria." },
      { status: 400 }
    );
  }

  const oldCriteriaKinds = opportunity.criteria.map((c) => c.kind).sort();

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.fundingOpportunity.update({ where: { id: opportunityId }, data });
    }
    if (revisingCriteria) {
      // Replace wholesale: MatchCandidate rows reference the JOB's frozen
      // snapshot, never these rows directly, so deleting and recreating the
      // live criteria set cannot corrupt any past result.
      await tx.opportunityCriterion.deleteMany({ where: { opportunityId } });
      if (criteriaRows.length > 0) {
        await tx.opportunityCriterion.createMany({
          data: criteriaRows.map((r) => ({ ...r, opportunityId })),
        });
      }
    }
  });

  await logAdminAction({
    adminId,
    action: "OPPORTUNITY_REVISED",
    entityType: "OPPORTUNITY",
    entityId: opportunityId,
    oldValue: {
      ...(data.title !== undefined ? { title: opportunity.title } : {}),
      ...(data.amount !== undefined ? { amount: opportunity.amount?.toString() ?? null } : {}),
      ...(revisingCriteria ? { criteriaKinds: oldCriteriaKinds } : {}),
    },
    newValue: {
      ...data,
      ...(revisingCriteria ? { criteriaKinds: criteriaRows.map((r) => r.kind).sort() } : {}),
    },
    request,
  });

  return NextResponse.json({ id: opportunityId, revised: true });
}
