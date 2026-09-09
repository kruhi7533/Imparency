import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkFunderEligibility } from "@/lib/matching/funder";

export const runtime = "nodejs";

/**
 * ADMIN-only. Move a funding opportunity through its lifecycle.
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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const body = await request.json();
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
