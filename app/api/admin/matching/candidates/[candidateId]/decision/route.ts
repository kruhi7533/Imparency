import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { openNgoInquiryThread } from "@/lib/inquiry-thread";
import {
  buildShortlistMessage,
  buildShortlistSubject,
  notifyFunderOfShortlist,
} from "@/lib/matching/notify";
import { captureError } from "@/lib/observability";
import type { CriterionResult } from "@/lib/matching/types";

export const runtime = "nodejs";

/**
 * ADMIN-only. The human gate on the shortlist.
 *
 * This route is the ONLY thing in the codebase that moves a candidate off
 * "PROPOSED" — the engine writes `verdict` and never touches `decision`. Same
 * separation as ExtractedField, where only a human PATCH produces VALIDATED.
 *
 * Shortlisting an organisation the engine did not find eligible is permitted,
 * but never silently: it requires a note, exactly as review-project requires
 * one when an admin overrides the AI recommendation.
 */
export async function POST(
  request: Request,
  { params }: { params: { candidateId: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const { action, note } = await request.json();
    if (action !== "SHORTLIST" && action !== "DISMISS") {
      return NextResponse.json({ error: "action must be SHORTLIST or DISMISS" }, { status: 400 });
    }

    const candidate = await prisma.matchCandidate.findUnique({
      where: { id: params.candidateId },
      select: {
        id: true,
        jobId: true,
        ngoId: true,
        verdict: true,
        decision: true,
        reasons: true,
        ngo: { select: { orgName: true } },
        job: {
          select: {
            opportunityId: true,
            opportunity: { select: { title: true, funderName: true, funderUserId: true } },
          },
        },
      },
    });
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const trimmedNote = typeof note === "string" ? note.trim() : "";
    const overrodeEngine = action === "SHORTLIST" && candidate.verdict !== "ELIGIBLE";

    if (overrodeEngine && !trimmedNote) {
      return NextResponse.json(
        {
          error:
            `The engine did not find this organisation eligible (${candidate.verdict.toLowerCase()}). ` +
            `Explain why it is being shortlisted anyway.`,
        },
        { status: 400 }
      );
    }

    const decision = action === "SHORTLIST" ? "SHORTLISTED" : "DISMISSED";

    const { count } = await prisma.matchCandidate.updateMany({
      where: { id: params.candidateId, decision: "PROPOSED" },
      data: {
        decision,
        decidedById: adminId,
        decidedAt: new Date(),
        decisionNote: trimmedNote || null,
      },
    });
    if (count === 0) {
      return NextResponse.json(
        {
          error: `This candidate has already been decided (${candidate.decision.toLowerCase()}). Refresh to see the current state.`,
        },
        { status: 409 }
      );
    }

    // Codes, not sentences; ids, not names. The reason prose already lives on
    // the candidate row, and this log outlives PII retention on the main tables.
    const failedCodes = Array.isArray(candidate.reasons)
      ? (candidate.reasons as unknown as CriterionResult[])
          .filter((r) => r?.outcome === "FAIL")
          .map((r) => r.code)
      : [];

    await logAdminAction({
      adminId,
      action: action === "SHORTLIST" ? "CANDIDATE_SHORTLISTED" : "CANDIDATE_DISMISSED",
      entityType: "MATCH_CANDIDATE",
      entityId: params.candidateId,
      oldValue: { decision: "PROPOSED" },
      newValue: { decision },
      note: trimmedNote || null,
      metadata: {
        jobId: candidate.jobId,
        ngoId: candidate.ngoId,
        verdict: candidate.verdict,
        failedCodes,
        overrodeEngine,
      },
      request,
    });

    // Shortlisting reaches the organisation automatically: a thread it can
    // reply on, a notification, and an email.
    //
    // Only shortlisting. A dismissal stays silent — "you were not shortlisted"
    // is a message with consequences and there is no appeal path to point it
    // at yet, so sending it would be worse than saying nothing.
    //
    // Deliberately after the compare-and-swap and deliberately non-fatal: the
    // decision is already recorded and must not be undone by a mail provider
    // being down. A failure here is captured, not returned.
    let notifiedThreadId: string | null = null;
    if (action === "SHORTLIST") {
      try {
        notifiedThreadId = await openNgoInquiryThread({
          ngoId: candidate.ngoId,
          adminId,
          subject: buildShortlistSubject(candidate.job.opportunity.title),
          body: buildShortlistMessage({
            opportunityTitle: candidate.job.opportunity.title,
            funderName: candidate.job.opportunity.funderName,
            note: trimmedNote || null,
          }),
          entityType: "OPPORTUNITY",
          entityId: candidate.job.opportunityId,
          notificationType: "OPPORTUNITY_SHORTLISTED",
          notificationTitle: "Your organisation has been shortlisted",
          request,
        });
      } catch (notifyErr) {
        captureError(
          notifyErr,
          {
            scope: "api/admin/matching/decision",
            operation: "notify_shortlisted_ngo",
            entityType: "MATCH_CANDIDATE",
            entityId: params.candidateId,
            userId: adminId,
            extra: { ngoId: candidate.ngoId, jobId: candidate.jobId },
          },
          "error"
        );
      }

      // Tell the funder too, when their opportunity is linked to an account.
      // Most are not — funderName is a display string and there is no funder
      // organisation in the model — so this is a no-op for offline funders.
      // Non-fatal for the same reason as above: the decision already stands.
      if (candidate.job.opportunity.funderUserId) {
        try {
          await notifyFunderOfShortlist({
            opportunityId: candidate.job.opportunityId,
            opportunityTitle: candidate.job.opportunity.title,
            funderUserId: candidate.job.opportunity.funderUserId,
            ngoName: candidate.ngo.orgName,
            adminId,
            request,
          });
        } catch (funderErr) {
          captureError(
            funderErr,
            {
              scope: "api/admin/matching/decision",
              operation: "notify_funder_of_shortlist",
              entityType: "OPPORTUNITY",
              entityId: candidate.job.opportunityId,
              userId: adminId,
              extra: { candidateId: params.candidateId },
            },
            "error"
          );
        }
      }
    }

    return NextResponse.json({
      id: params.candidateId,
      decision,
      // null on a shortlist means the organisation was NOT reached — the admin
      // needs to know that, rather than assuming the message went out.
      notifiedThreadId,
    });
  } catch (err: any) {
    console.error("Failed to decide on candidate:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
