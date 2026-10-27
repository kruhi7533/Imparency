import prisma from "@/lib/prisma";
import { loadNgoImpactCockpit } from "@/lib/outcome-cockpit";
import { loadNgoFeedbackByProject, donorFeedbackSummary, type FeedbackRow } from "@/lib/feedback-summary";
import { ASSERTED_STATUSES } from "@/lib/impact-quality";

/**
 * The NGO's impact report DRAFT (NGO-017): per project, what the organisation
 * has asserted, what is verified, the baseline → endline change where verified
 * figures support one (INSUFFICIENT_DATA otherwise), the evidence behind it,
 * and beneficiary feedback — with a preview of exactly what a funder would
 * see, so the NGO is never surprised by the donor view.
 *
 * Tenant-scoped by ngoId; the caller resolves it from the session.
 */
export async function loadNgoImpactReport(ngoId: string) {
  const [cockpit, feedback, evidenceCounts, feedbackRows] = await Promise.all([
    loadNgoImpactCockpit(ngoId),
    loadNgoFeedbackByProject(ngoId),
    prisma.fieldEvidence.groupBy({ by: ["projectId", "status"], where: { ngoId }, _count: { _all: true } }),
    prisma.beneficiaryFeedback.findMany({
      where: { ngoId },
      select: { projectId: true, consentToRecord: true, withdrawnAt: true, rating: true, capturedAt: true },
      take: 5000,
    }),
  ]);

  const projects = cockpit.projects.map((p) => {
    const claims = cockpit.claims.filter((c) => c.projectId === p.id && ASSERTED_STATUSES.includes(c.status));
    const counts = { PENDING_REVIEW: 0, APPROVED: 0, RESUBMIT_REQUESTED: 0, REJECTED: 0 } as Record<string, number>;
    for (const e of evidenceCounts.filter((x) => x.projectId === p.id)) counts[e.status] = e._count._all;
    const donorRows: FeedbackRow[] = feedbackRows
      .filter((r) => r.projectId === p.id)
      .map((r) => ({ ...r, beneficiaryRef: null, feedbackText: null }));
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      figures: claims.map((c) => ({
        id: c.id,
        metricName: c.metricName,
        value: c.value,
        unit: c.unit,
        status: c.status,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        display: c.display,
        blockingFindings: (c.triage?.findings ?? []).filter((f) => f.severity === "BLOCK").map((f) => f.code),
      })),
      changes: cockpit.changes.filter((c) => c.projectId === p.id),
      evidence: counts,
      feedback: feedback.byProject[p.id] ?? null,
      donorFeedbackPreview: donorFeedbackSummary(donorRows),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    projects,
    rollup: cockpit.rollup,
    feedbackOverall: feedback.overall,
  };
}

export type NgoImpactReport = Awaited<ReturnType<typeof loadNgoImpactReport>>;
