import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkWithdrawal, resolveNgoActor, withdrawalData } from "@/lib/field-evidence";
import { propagateWithdrawalToStories } from "@/lib/impact-story-service";

/**
 * Record a beneficiary's withdrawal of consent (Week 7, P0 privacy).
 *
 * Any member of the NGO that captured the feedback may record it. Idempotent:
 * a second call — or a concurrent one that lost the race — returns the
 * existing withdrawal rather than an error, because the beneficiary's wish has
 * been honoured either way.
 *
 * Propagation (NEG-003). The withdrawal itself takes effect everywhere that
 * reads consent live: donor evidence lists (DONOR_VISIBLE_EVIDENCE_WHERE), the
 * photo route (signed links are re-checked against consent on every fetch,
 * so a link issued before the withdrawal stops working — lib/evidence-access.ts), and outcome figures (re-triaged at read time, so a claim citing
 * this feedback renders "unverified" on every report, published or not).
 * Generated stories hold copied text, so they are unpublished and marked for
 * regeneration here. That step runs on every call, replays included, so a
 * retry after a failed propagation completes it.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const userId: string = session.user.id;

    const actor = await resolveNgoActor(userId);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

    const feedback = await prisma.beneficiaryFeedback.findUnique({
      where: { id: params.id },
      select: { id: true, ngoId: true, withdrawnAt: true, evidenceId: true },
    });
    const check = checkWithdrawal(feedback, actor.ngoId);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (check.noop) {
      const storiesUnpublished = await propagateWithdrawalToStories(params.id, feedback!.evidenceId ?? null);
      return NextResponse.json({ ok: true, withdrawnAt: feedback!.withdrawnAt, replayed: true, storiesUnpublished });
    }

    const data = withdrawalData(userId);
    const { count } = await prisma.beneficiaryFeedback.updateMany({
      where: { id: params.id, ngoId: actor.ngoId, withdrawnAt: null },
      data,
    });
    if (count === 0) {
      // Someone recorded it a moment ago. Same outcome; report theirs.
      const current = await prisma.beneficiaryFeedback.findUnique({ where: { id: params.id }, select: { withdrawnAt: true } });
      const storiesUnpublished = await propagateWithdrawalToStories(params.id, feedback!.evidenceId ?? null);
      return NextResponse.json({ ok: true, withdrawnAt: current?.withdrawnAt ?? null, replayed: true, storiesUnpublished });
    }
    const storiesUnpublished = await propagateWithdrawalToStories(params.id, feedback!.evidenceId ?? null);
    return NextResponse.json({ ok: true, withdrawnAt: data.withdrawnAt, storiesUnpublished });
  } catch (error) {
    console.error("[api/field/feedback/[id]/withdraw] POST error:", error);
    return NextResponse.json({ error: "Failed to record consent withdrawal" }, { status: 500 });
  }
}
