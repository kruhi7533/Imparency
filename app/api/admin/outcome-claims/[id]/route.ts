import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction, type AdminAction } from "@/lib/admin-log";
import {
  isOutcomeAction,
  isAdminOnly,
  canApply,
  requiresNote,
  explainRefusal,
  OUTCOME_TRANSITIONS,
  type OutcomeAction,
} from "@/lib/outcome-workflow";
import { triageOutcomeClaim } from "@/lib/outcome-triage";
import { resolveCitations, evidenceAlreadyCounted } from "@/lib/outcome-evidence";

/**
 * PATCH /api/admin/outcome-claims/[id] — approve, return for evidence, or
 * reject a reported number.
 *
 * **The gate that matters is here, not in the UI.** A claim whose triage
 * verdict is BLOCKED cannot be approved through this route at all. Disabling a
 * button would leave the hole open to anyone who can send a PATCH, and the
 * whole point of Week 8 is that an unsupported number cannot become a
 * donor-facing figure — a rule enforced only in a React component is not a
 * rule (same position as the ACTIVE/requiredEvidence constraint living in
 * lib/metric-registry.ts rather than the form).
 *
 * The triage is re-run at decision time rather than trusted from page load.
 * Evidence can be un-approved, consent can be withdrawn, and another claim can
 * be approved against the same photo between an admin opening the queue and
 * clicking approve.
 */
export const runtime = "nodejs";

const AUDIT_ACTION: Record<Extract<OutcomeAction, "APPROVE" | "REQUEST_EVIDENCE" | "REJECT">, AdminAction> = {
  APPROVE: "OUTCOME_CLAIM_APPROVED",
  REQUEST_EVIDENCE: "OUTCOME_CLAIM_EVIDENCE_REQUESTED",
  REJECT: "OUTCOME_CLAIM_REJECTED",
};

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

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

  // SUBMIT and WITHDRAW belong to the organisation that filed the claim. An
  // admin withdrawing a number on an NGO's behalf would make the audit trail
  // say the organisation retracted something it did not.
  if (!isAdminOnly(action)) {
    return NextResponse.json(
      { error: "This action belongs to the organisation that filed the claim." },
      { status: 403 }
    );
  }

  const claim = await prisma.outcomeClaim.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      value: true,
      unit: true,
      periodStart: true,
      periodEnd: true,
      metricCode: true,
      metric: { select: { code: true, unit: true, status: true, requiredEvidence: true } },
      citations: { select: { id: true, kind: true, proofId: true, evidenceId: true, feedbackId: true } },
    },
  });
  if (!claim) return NextResponse.json({ error: "Claim not found." }, { status: 404 });

  if (!canApply(action, claim.status)) {
    return NextResponse.json({ error: explainRefusal(action, claim.status) }, { status: 409 });
  }

  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (requiresNote(action) && note.length < 10) {
    return NextResponse.json(
      {
        error:
          action === "REJECT"
            ? "A rejection needs a reason of at least 10 characters — the organisation has to be able to answer it."
            : "Say what evidence is missing, in at least 10 characters.",
      },
      { status: 400 }
    );
  }

  // --- the evidence gate ---------------------------------------------------
  const [resolved, alreadyCounted] = await Promise.all([
    resolveCitations(claim.citations),
    evidenceAlreadyCounted(claim.metricCode, claim.id),
  ]);

  const triage = triageOutcomeClaim({
    claim: {
      id: claim.id,
      // Decimal -> string, never through a float.
      value: claim.value.toString(),
      unit: claim.unit,
      periodStart: claim.periodStart,
      periodEnd: claim.periodEnd,
    },
    metric: claim.metric,
    citations: resolved,
    evidenceCitedByApprovedClaims: alreadyCounted,
  });

  if (action === "APPROVE" && triage.verdict === "BLOCKED") {
    return NextResponse.json(
      {
        error:
          "This claim cannot be approved: the evidence behind it does not support the number. " +
          "Return it for evidence instead.",
        findings: triage.findings,
      },
      { status: 422 }
    );
  }

  const to = OUTCOME_TRANSITIONS[action].to;

  // Compare-and-swap: two admins deciding at once, the second gets a 409.
  const { count } = await prisma.outcomeClaim.updateMany({
    where: { id: claim.id, status: claim.status },
    data: {
      status: to,
      decidedById: session.user.id,
      decidedAt: new Date(),
      decisionNote: note || null,
    },
  });

  if (count === 0) {
    return NextResponse.json(
      { error: "This claim was decided by someone else while you were reviewing it. Reload." },
      { status: 409 }
    );
  }

  // Ids, enum values and counts only. The method text and the organisation's
  // name stay out of a log that outlives PII retention on the main tables, and
  // the finding CODES are recorded rather than their messages, which embed
  // evidence ids and counts.
  await logAdminAction({
    adminId: session.user.id,
    action: AUDIT_ACTION[action as keyof typeof AUDIT_ACTION],
    entityType: "OUTCOME_CLAIM",
    entityId: claim.id,
    oldValue: { status: claim.status },
    newValue: {
      status: to,
      metricCode: claim.metricCode,
      triageVerdict: triage.verdict,
      findingCodes: triage.findings.map((f) => f.code),
      citationCount: claim.citations.length,
    },
    request,
  });

  return NextResponse.json({
    claim: { id: claim.id, status: to },
    triage,
  });
}
