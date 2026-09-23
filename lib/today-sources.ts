import type { InboxSources } from "@/lib/today-inbox";

/**
 * Every query the admin inbox is built from, in one place.
 *
 * Extracted from app/admin/today/page.tsx when the SLA view needed the same
 * items judged against a different question. Two pages assembling the inbox
 * from two copies of these queries would drift the moment a queue was added to
 * one and not the other — and the drift would be invisible, because both pages
 * would still render.
 *
 * Takes the client rather than importing it so a test can pass a mock.
 */
/**
 * The organisation behind each alert, in three batched queries.
 *
 * FraudAlert.entityType/entityId is polymorphic with no relation to join
 * through, and the id is frequently NOT an NGO id: an alert about a milestone
 * stores a milestone id, one about a campaign stores a project id. Both still
 * concern the organisation behind that record, which is the name an admin
 * needs on the card and the page the card should open.
 *
 * Every id is tried against all three tables rather than trusting entityType,
 * because rows written before lib/risk-agent.ts was corrected still carry a
 * milestone id under entityType "NGO". Three queries regardless of how many
 * alerts there are — the earlier version issued one lookup per alert.
 */
async function resolveAlertOrganisations(
  prisma: any,
  alerts: { entityId: string }[]
): Promise<Record<string, { ngoId: string; orgName: string }>> {
  const ids = Array.from(new Set(alerts.map((a) => a.entityId))).filter(Boolean);
  if (ids.length === 0) return {};

  const [ngos, milestones, projects] = await Promise.all([
    prisma.nGOProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, orgName: true },
    }),
    prisma.milestone.findMany({
      where: { id: { in: ids } },
      select: { id: true, project: { select: { ngoId: true, ngo: { select: { orgName: true } } } } },
    }),
    prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, ngoId: true, ngo: { select: { orgName: true } } },
    }),
  ]);

  const resolved: Record<string, { ngoId: string; orgName: string }> = {};
  for (const n of ngos as { id: string; orgName: string }[]) {
    resolved[n.id] = { ngoId: n.id, orgName: n.orgName };
  }
  for (const m of milestones as {
    id: string;
    project: { ngoId: string; ngo: { orgName: string } };
  }[]) {
    resolved[m.id] = { ngoId: m.project.ngoId, orgName: m.project.ngo.orgName };
  }
  for (const p of projects as { id: string; ngoId: string; ngo: { orgName: string } }[]) {
    resolved[p.id] = { ngoId: p.ngoId, orgName: p.ngo.orgName };
  }
  return resolved;
}

export async function loadInboxSources(prisma: any): Promise<InboxSources> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  // Hoisted out of the Promise.all below: an `await` inside an array literal
  // suspends construction of the array, so the overdue-milestone query at the
  // end could not start until this one finished. See the identical fix in
  // `admin/impact-health` — measured 987ms before, 366ms after.
  const recentlyActiveProjectIds = (
    await prisma.projectImpactEvent.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { projectId: true },
      distinct: ["projectId"],
    })
  ).map((e: { projectId: string }) => e.projectId);

  const [
    pendingNgos,
    pendingProjects,
    completedProjects,
    openProposals,
    pendingProofs,
    pendingFcra,
    openAlerts,
    openRiskReviews,
    threadsNeedingReply,
    quietNgos,
    overdueMilestones,
    submittedOpportunities,
    proposedCandidates,
  ] = await Promise.all([
    prisma.nGOProfile.findMany({
      where: { verificationStatus: "PENDING" },
      select: { id: true, orgName: true, createdAt: true },
    }),
    prisma.project.findMany({
      where: { status: "PENDING_APPROVAL" },
      select: { id: true, title: true, createdAt: true, ngo: { select: { orgName: true } } },
    }),
    // Projects that finished recently and still want a close-out. Windowed by
    // updatedAt (Project has no completedAt) so the queue cannot grow without
    // bound.
    prisma.project.findMany({
      where: { status: "COMPLETED", isDeleted: false, updatedAt: { gte: thirtyDaysAgo } },
      select: { id: true, title: true, updatedAt: true, ngo: { select: { orgName: true } } },
    }),
    // Proposals waiting on a human — the step between shortlisting and a
    // funded project.
    prisma.proposal.findMany({
      where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      select: {
        id: true,
        title: true,
        status: true,
        submittedAt: true,
        createdAt: true,
        ngo: { select: { orgName: true } },
        opportunity: { select: { title: true } },
      },
    }),
    prisma.milestone.findMany({
      where: { status: "PROOF_SUBMITTED" },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        project: { select: { title: true, ngo: { select: { orgName: true } } } },
      },
    }),
    prisma.nGOCompliance.findMany({
      where: { fcraStatus: "PENDING" },
      select: { id: true, updatedAt: true, ngo: { select: { id: true, orgName: true } } },
    }),
    prisma.fraudAlert.findMany({
      where: { resolved: false },
      // `description` says what the defect is; `entityId` is what lets the card
      // name the organisation and link to it.
      select: {
        id: true,
        type: true,
        severity: true,
        createdAt: true,
        entityType: true,
        entityId: true,
        description: true,
      },
    }),
    prisma.riskReview.findMany({
      where: { status: { in: ["OPEN", "ESCALATED"] } },
      select: {
        id: true,
        riskLevel: true,
        status: true,
        createdAt: true,
        ngo: { select: { orgName: true } },
      },
    }),
    prisma.reviewThread.findMany({
      where: { status: "NGO_RESPONDED" },
      select: { id: true, subject: true, updatedAt: true, subjectType: true, subjectId: true },
    }),
    // Quiet NGOs — same check as Impact Health
    prisma.nGOProfile.findMany({
      where: {
        verificationStatus: "VERIFIED",
        isSuspended: false,
        projects: { some: { status: "ACTIVE", id: { notIn: recentlyActiveProjectIds } } },
      },
      select: { id: true, orgName: true },
    }),
    // Overdue milestones — same check as the reminder cron / Impact Health
    prisma.milestone.findMany({
      where: { status: { in: ["PENDING", "IN_PROGRESS"] }, deadline: { lt: now } },
      select: {
        id: true,
        title: true,
        deadline: true,
        project: { select: { title: true, ngo: { select: { orgName: true } } } },
      },
    }),
    // Opportunity approvals — a donor proposed this, an admin must APPROVE or
    // REJECT before it can go OPEN.
    prisma.fundingOpportunity.findMany({
      where: { status: "SUBMITTED" },
      select: { id: true, title: true, funderName: true, createdAt: true },
    }),
    // Match candidate decisions — the engine proposed these as PROPOSED, an
    // admin must SHORTLIST or DISMISS.
    prisma.matchCandidate.findMany({
      // Only the current run for each opportunity. A re-match supersedes its
      // predecessors (see MatchingJob.supersededAt), and their undecided
      // candidates were judged against criteria that have since been revised —
      // showing them put one opportunity in the queue once per run.
      where: { decision: "PROPOSED", job: { supersededAt: null } },
      select: {
        id: true,
        jobId: true,
        verdict: true,
        createdAt: true,
        ngo: { select: { orgName: true } },
        job: { select: { opportunityId: true, opportunity: { select: { title: true } } } },
      },
    }),
  ]);

  const alertNgos = await resolveAlertOrganisations(prisma, openAlerts);

  return {
    pendingNgos,
    pendingProjects,
    completedProjects,
    openProposals,
    pendingProofs,
    pendingFcra,
    openAlerts,
    openRiskReviews,
    threadsNeedingReply,
    quietNgos,
    overdueMilestones,
    submittedOpportunities,
    proposedCandidates,
    alertNgos,
  };
}
