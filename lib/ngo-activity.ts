import prisma from "@/lib/prisma";

/**
 * An NGO's own activity history (roadmap row 5, "NGO audit"): every decision
 * taken on or by the organisation, in one timeline, from the logs the platform
 * already keeps. Nothing new is recorded; this is a read model.
 *
 * What an NGO must NOT see is the reason most of this file exists:
 * - Admin actions come from an ALLOWLIST. Risk flags, trust-insight runs,
 *   screening and nudges are internal investigation steps; showing them would
 *   tip off the organisation being investigated.
 * - Admin notes are never shown from the admin action log (they are written
 *   for other admins). Review notes that were written FOR the NGO — milestone
 *   proof reviews, field evidence reviews, outcome-claim decisions — are, since
 *   the NGO already sees them on the screens where they act on them.
 * - Platform staff appear as "Platform reviewer", never by name.
 */

export type ActivityKind = "VERIFICATION" | "PROJECT" | "COMPLIANCE" | "CONTRACT" | "PROOF" | "FIELD" | "OUTCOME" | "FUNDING";

export interface ActivityItem {
  at: Date;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  actor: string;
  href: string | null;
}

export const NGO_VISIBLE_ADMIN_ACTIONS: Record<string, string> = {
  NGO_APPROVED: "Organisation verified",
  NGO_REJECTED: "Verification rejected",
  NGO_SUSPENDED: "Organisation suspended",
  NGO_REINSTATED: "Organisation reinstated",
  PROJECT_APPROVED: "Project approved",
  PROJECT_REJECTED: "Project returned / rejected",
};

export const REVIEWER = "Platform reviewer";

const humanise = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Newest first, capped. Ties keep source order so the output is deterministic. */
export function mergeActivity<T extends { at: Date }>(sources: T[][], limit = 200): T[] {
  return sources
    .flat()
    .map((item, i) => ({ item, i }))
    .sort((a, b) => b.item.at.getTime() - a.item.at.getTime() || a.i - b.i)
    .slice(0, limit)
    .map(({ item }) => item);
}

export async function loadNgoActivity(ngoId: string, limit = 200): Promise<ActivityItem[]> {
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: ngoId },
    select: {
      userId: true,
      user: { select: { name: true } },
      teamMembers: { select: { userId: true, user: { select: { name: true } } } },
      compliance: { select: { id: true } },
      projects: { select: { id: true, title: true, fundedAt: true } },
    },
  });
  if (!ngo) return [];

  // Names only for the NGO's own people; anyone else is described by role.
  const team = new Map<string, string>([
    [ngo.userId, ngo.user.name || "Owner"],
    ...ngo.teamMembers.map((m) => [m.userId, m.user.name || "Team member"] as [string, string]),
  ]);
  const projectIds = ngo.projects.map((p) => p.id);
  const projectTitle = new Map(ngo.projects.map((p) => [p.id, p.title]));
  const take = limit;

  const [adminActions, compliance, contractLogs, reviews, evidence, claims] = await Promise.all([
    prisma.adminActionLog.findMany({
      where: {
        action: { in: Object.keys(NGO_VISIBLE_ADMIN_ACTIONS) },
        OR: [
          { entityType: "NGO", entityId: ngoId },
          ...(projectIds.length ? [{ entityType: "PROJECT", entityId: { in: projectIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take,
      select: { action: true, entityType: true, entityId: true, createdAt: true },
    }),
    ngo.compliance
      ? prisma.complianceAuditLog.findMany({
          where: { complianceId: ngo.compliance.id },
          orderBy: { createdAt: "desc" },
          take,
          select: { event: true, detail: true, createdAt: true },
        })
      : Promise.resolve([]),
    prisma.contractAuditLog.findMany({
      where: { contract: { ngoId } },
      orderBy: { createdAt: "desc" },
      take,
      select: { action: true, actorId: true, actorRole: true, detail: true, createdAt: true, contractId: true, contract: { select: { title: true } } },
    }),
    prisma.milestoneReview.findMany({
      where: { milestone: { project: { ngoId } } },
      orderBy: { reviewedAt: "desc" },
      take,
      select: { action: true, note: true, reviewedAt: true, milestone: { select: { title: true, projectId: true } } },
    }),
    prisma.fieldEvidence.findMany({
      where: { ngoId, reviewedAt: { not: null } },
      orderBy: { reviewedAt: "desc" },
      take,
      select: { status: true, reviewNote: true, reviewedAt: true, projectId: true, task: { select: { title: true } } },
    }),
    prisma.outcomeClaim.findMany({
      where: { ngoId, OR: [{ submittedAt: { not: null } }, { decidedAt: { not: null } }] },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        status: true,
        submittedAt: true,
        submittedById: true,
        decidedAt: true,
        decisionNote: true,
        metric: { select: { name: true } },
        projectId: true,
      },
    }),
  ]);

  const items: ActivityItem[][] = [
    adminActions.map((a) => ({
      at: a.createdAt,
      kind: a.entityType === "NGO" ? "VERIFICATION" : "PROJECT",
      title: NGO_VISIBLE_ADMIN_ACTIONS[a.action],
      detail: a.entityType === "PROJECT" ? projectTitle.get(a.entityId) ?? null : null,
      actor: REVIEWER,
      href: a.entityType === "PROJECT" ? `/ngo/projects/${a.entityId}` : null,
    })),
    compliance.map((c) => ({
      at: c.createdAt,
      kind: "COMPLIANCE" as const,
      title: humanise(c.event),
      detail: c.detail,
      actor: "Compliance",
      href: null,
    })),
    contractLogs.map((l) => ({
      at: l.createdAt,
      kind: "CONTRACT" as const,
      title: `${humanise(l.action)} — ${l.contract.title}`,
      detail: l.detail,
      actor: team.get(l.actorId) ?? (l.actorRole === "DONOR" ? "Funder" : l.actorRole === "ADMIN" ? REVIEWER : humanise(l.actorRole)),
      href: `/ngo/contracts/${l.contractId}`,
    })),
    reviews.map((r) => ({
      at: r.reviewedAt,
      kind: "PROOF" as const,
      title: `Milestone proof ${r.action === "APPROVED" ? "approved" : "rejected"} — ${r.milestone.title}`,
      detail: r.note,
      actor: REVIEWER,
      href: `/ngo/projects/${r.milestone.projectId}`,
    })),
    evidence.map((e) => ({
      at: e.reviewedAt!,
      kind: "FIELD" as const,
      title: `Field evidence ${humanise(e.status).toLowerCase()} — ${e.task.title}`,
      detail: e.reviewNote,
      actor: REVIEWER,
      href: `/ngo/projects/${e.projectId}`,
    })),
    claims.flatMap((c) => {
      const out: ActivityItem[] = [];
      if (c.submittedAt) {
        out.push({
          at: c.submittedAt,
          kind: "OUTCOME",
          title: `Outcome claim submitted — ${c.metric.name}`,
          detail: null,
          actor: (c.submittedById && team.get(c.submittedById)) || "Your organisation",
          href: "/ngo/impact",
        });
      }
      if (c.decidedAt && ["APPROVED", "REJECTED", "NEEDS_EVIDENCE"].includes(c.status)) {
        out.push({
          at: c.decidedAt,
          kind: "OUTCOME",
          title: `Outcome claim ${c.status === "NEEDS_EVIDENCE" ? "returned for evidence" : c.status.toLowerCase()} — ${c.metric.name}`,
          detail: c.decisionNote,
          actor: REVIEWER,
          href: "/ngo/impact",
        });
      }
      return out;
    }),
    ngo.projects
      .filter((p) => p.fundedAt)
      .map((p) => ({
        at: p.fundedAt!,
        kind: "FUNDING" as const,
        title: `Project fully funded — ${p.title}`,
        detail: "Every committed rupee is reconciled.",
        actor: "Platform",
        href: `/ngo/projects/${p.id}`,
      })),
  ];

  return mergeActivity(items, limit);
}
