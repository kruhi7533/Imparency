import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { openNgoInquiryThread } from "@/lib/inquiry-thread";
import {
  buildShortlistMessage,
  buildShortlistSubject,
  findShortlistThread,
} from "@/lib/matching/notify";

export const runtime = "nodejs";

/**
 * ADMIN-only. Tell a shortlisted organisation that was never told.
 *
 * Shortlisting notifies automatically, so this exists for the two cases where
 * that did not happen: a candidate decided before notification was wired, and
 * one whose send failed (the decision route deliberately keeps the shortlist
 * and reports `notifiedThreadId: null` rather than rolling back).
 *
 * Refuses to send twice. Sending "you have been shortlisted" a second time
 * reads as a second opportunity, so a duplicate is not a harmless retry.
 */
export async function POST(
  _request: Request,
  { params }: { params: { candidateId: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const candidate = await prisma.matchCandidate.findUnique({
      where: { id: params.candidateId },
      select: {
        id: true,
        ngoId: true,
        decision: true,
        decisionNote: true,
        job: {
          select: {
            opportunityId: true,
            opportunity: { select: { title: true, funderName: true } },
          },
        },
      },
    });
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    // Only a shortlisting is announceable. A dismissal stays silent, and a
    // still-proposed candidate has not been decided at all.
    if (candidate.decision !== "SHORTLISTED") {
      return NextResponse.json(
        { error: `Only a shortlisted organisation can be notified (this one is ${candidate.decision.toLowerCase()}).` },
        { status: 409 }
      );
    }

    const existing = await findShortlistThread(candidate.ngoId, candidate.job.opportunityId);
    if (existing) {
      return NextResponse.json(
        { error: "This organisation has already been told about this opportunity.", threadId: existing },
        { status: 409 }
      );
    }

    const threadId = await openNgoInquiryThread({
      ngoId: candidate.ngoId,
      adminId,
      subject: buildShortlistSubject(candidate.job.opportunity.title),
      body: buildShortlistMessage({
        opportunityTitle: candidate.job.opportunity.title,
        funderName: candidate.job.opportunity.funderName,
        note: candidate.decisionNote,
      }),
      entityType: "OPPORTUNITY",
      entityId: candidate.job.opportunityId,
      notificationType: "OPPORTUNITY_SHORTLISTED",
      notificationTitle: "Your organisation has been shortlisted",
      request: _request,
    });

    return NextResponse.json({ id: params.candidateId, notifiedThreadId: threadId });
  } catch (err: any) {
    console.error("Failed to notify shortlisted candidate:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
