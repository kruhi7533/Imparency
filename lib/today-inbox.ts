/**
 * Shaping and grouping for the admin Today inbox.
 *
 * Kept out of the page so the categorisation can be tested directly: which
 * queue lands in which category, and the order items appear in, are the two
 * things that would silently rot if a new queue were added without thought.
 *
 * Icons deliberately stay in the page — this module is data only, so it runs
 * in a plain node test without React.
 */

import { daysOverTarget, slaState } from "@/lib/sla";

export type Severity = "high" | "medium" | "low";

/**
 * Categories answer one question: who owes the next move?
 *
 * The earlier cut (Approvals / Decisions / Blocked-SLA) mixed three unrelated
 * meanings into its third bucket — a reply the admin owed, a milestone the NGO
 * owed, and a health signal nobody owed — and the "SLA" in its name promised a
 * deadline mechanism that does not exist. Sorting by who is blocked is
 * something the data can actually answer.
 *
 * A view label only — it changes no underlying state.
 */
export type Category = "Waiting on you" | "Waiting on others" | "Signals";

export const CATEGORY_ORDER: Category[] = ["Waiting on you", "Waiting on others", "Signals"];

/** Shown under each column heading — the label alone does not explain itself. */
export const CATEGORY_HINT: Record<Category, string> = {
  "Waiting on you": "You owe the next action.",
  "Waiting on others": "An organisation owes work. You can chase, not resolve.",
  Signals: "Nobody is blocked. Worth knowing.",
};

/**
 * Which icon the card shows. A name, not a component, because two items can
 * share a queue and still need different icons (Impact Health covers both
 * quiet NGOs and overdue milestones) — and because this module must not
 * import React.
 */
export type IconKey =
  | "ngo"
  | "opportunity"
  | "project"
  | "completed"
  | "proposal"
  | "proof"
  | "fcra"
  | "candidate"
  | "risk"
  | "alert"
  | "thread"
  | "quiet"
  | "overdue";

export interface InboxItem {
  id: string;
  queue: string;
  category: Category;
  iconKey: IconKey;
  title: string;
  subtitle: string;
  /**
   * The individual problems behind a grouped row, listed under it.
   *
   * One organisation tripping several checks is one thing to look at, not
   * several — but the reader still needs to know what the several are, or the
   * grouping has just hidden the detail it replaced.
   */
  details?: string[];
  /**
   * When this arrived. `age` is whole days, which is too coarse to answer
   * "is this new since I last looked" for someone who opens Today twice a day.
   */
  occurredAt: Date;
  age: number; // days — sorts oldest first within a severity band
  severity: Severity;
  href: string;
}

export function daysSince(date: Date, now: number = Date.now()): number {
  return Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24));
}

/** The already-fetched rows the page hands over, named rather than positional. */
export interface InboxSources {
  pendingNgos: { id: string; orgName: string; createdAt: Date }[];
  submittedOpportunities: { id: string; title: string; funderName: string; createdAt: Date }[];
  pendingProjects: { id: string; title: string; createdAt: Date; ngo: { orgName: string } }[];
  /**
   * Projects that reached COMPLETED and still want an admin to close them out.
   *
   * Project has no `completedAt`, so the page windows these by `updatedAt` —
   * without a window every project ever finished would sit here forever.
   */
  completedProjects: { id: string; title: string; updatedAt: Date; ngo: { orgName: string } }[];
  /** Proposals a shortlisted organisation has submitted and nobody has decided. */
  openProposals: {
    id: string;
    title: string;
    status: string;
    submittedAt: Date | null;
    createdAt: Date;
    ngo: { orgName: string };
    opportunity: { title: string };
  }[];
  pendingProofs: {
    id: string;
    title: string;
    updatedAt: Date;
    project: { title: string; ngo: { orgName: string } };
  }[];
  pendingFcra: { id: string; updatedAt: Date; ngo: { id: string; orgName: string } }[];
  proposedCandidates: {
    id: string;
    jobId: string;
    verdict: string;
    createdAt: Date;
    ngo: { orgName: string };
    job: { opportunityId: string; opportunity: { title: string } };
  }[];
  openRiskReviews: {
    id: string;
    riskLevel: string;
    status: string;
    createdAt: Date;
    ngo: { orgName: string };
  }[];
  openAlerts: {
    id: string;
    type: string;
    severity: string;
    createdAt: Date;
    entityType: string;
    entityId: string;
    description?: string | null;
  }[];
  /**
   * An alert's entityId -> the organisation it concerns.
   *
   * FraudAlert.entityType/entityId is polymorphic with no relation behind it,
   * so this cannot be joined in. It carries the NGO's OWN id as well as its
   * name because the two are often different records: an alert about a
   * milestone stores a milestone id, and linking to `/admin/ngos/<milestoneId>`
   * would 404. An entityId missing from this map means "could not resolve",
   * and the card falls back to the queue rather than deep-linking nowhere.
   */
  alertNgos?: Record<string, { ngoId: string; orgName: string }>;
  threadsNeedingReply: { id: string; subject: string; updatedAt: Date; subjectType: string }[];
  quietNgos: { id: string; orgName: string }[];
  overdueMilestones: {
    id: string;
    title: string;
    deadline: Date;
    project: { title: string; ngo: { orgName: string } };
  }[];
}

/**
 * One row per matching job, not per candidate.
 *
 * Every candidate in a job links to the same page, and that page is where they
 * are decided together — so a job with eight undecided candidates was eight
 * rows pointing at one destination. A single candidate keeps the richer form,
 * naming the organisation, because there is nothing to summarise.
 *
 * The row carries the age of the OLDEST candidate: a job is as overdue as the
 * longest-waiting decision in it, not its most recent one.
 */
function collapseCandidatesByJob(
  candidates: InboxSources["proposedCandidates"],
  age: (d: Date) => number
): InboxItem[] {
  const byJob = new Map<string, InboxSources["proposedCandidates"]>();
  for (const c of candidates) {
    const group = byJob.get(c.jobId);
    if (group) group.push(c);
    else byJob.set(c.jobId, [c]);
  }

  return Array.from(byJob.values()).map((group): InboxItem => {
    const [first] = group;
    const oldest = Math.max(...group.map((c) => age(c.createdAt)));
    // The job is as old as its longest-waiting candidate, so it stops counting
    // as new once ANY candidate in it has been seen.
    const oldestAt = new Date(Math.min(...group.map((c) => c.createdAt.getTime())));
    const common = {
      queue: "Matching decisions",
      category: "Waiting on you" as Category,
      iconKey: "candidate" as IconKey,
      occurredAt: oldestAt,
      age: oldest,
      severity: (oldest > 5 ? "medium" : "low") as Severity,
      href: `/admin/opportunities/${first.job.opportunityId}/jobs/${first.jobId}`,
    };

    if (group.length === 1) {
      return {
        ...common,
        id: `candidate-${first.id}`,
        title: first.ngo.orgName,
        subtitle: `${first.job.opportunity.title} · engine says ${first.verdict.toLowerCase()} — waiting ${oldest}d`,
      };
    }

    const ordered = [...group].sort((a, b) => a.ngo.orgName.localeCompare(b.ngo.orgName));
    const details = ordered
      .slice(0, MAX_DETAIL_LINES)
      .map((c) => `${c.ngo.orgName} — engine says ${c.verdict.toLowerCase()}`);
    if (ordered.length > MAX_DETAIL_LINES) {
      details.push(`+${ordered.length - MAX_DETAIL_LINES} more`);
    }

    return {
      ...common,
      id: `job-${first.jobId}`,
      title: first.job.opportunity.title,
      subtitle: `${group.length} candidates awaiting a decision — oldest waiting ${oldest}d`,
      details,
    };
  });
}

const ALERT_SEVERITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** At most this many defects are spelled out; the rest are counted. */
export const MAX_DETAIL_LINES = 4;

/**
 * One row per organisation, not per alert.
 *
 * An NGO that fails three document checks is one organisation to look at, and
 * the checks are what you look at when you get there — so they belong under
 * the row, not as rows of their own. Ten rows naming the same NGO is a page
 * that cannot be read, and it is what the admin actually saw.
 *
 * The row takes the WORST severity and the OLDEST arrival in the group: a
 * grouped row must never be calmer or fresher than the worst thing inside it.
 */
function collapseAlertsByEntity(
  alerts: InboxSources["openAlerts"],
  ngos: Record<string, { ngoId: string; orgName: string }>,
  age: (d: Date) => number
): InboxItem[] {
  const byEntity = new Map<string, InboxSources["openAlerts"]>();
  for (const a of alerts) {
    const group = byEntity.get(a.entityId);
    if (group) group.push(a);
    else byEntity.set(a.entityId, [a]);
  }

  return Array.from(byEntity.entries()).map(([entityId, group]): InboxItem => {
    const org = ngos[entityId];
    const orgName = org?.orgName;
    const defect = (a: (typeof group)[number]) => a.description || a.type.replace(/_/g, " ");

    const worst = group.reduce((acc, a) =>
      (ALERT_SEVERITY_RANK[a.severity] ?? 3) < (ALERT_SEVERITY_RANK[acc.severity] ?? 3) ? a : acc
    );
    const oldestAt = new Date(Math.min(...group.map((a) => a.createdAt.getTime())));
    const oldest = age(oldestAt);

    const common = {
      queue: "Fraud Alerts",
      iconKey: "alert" as IconKey,
      // A LOW alert is something to be aware of; anything higher is a decision
      // the admin owes. A group is judged by its worst member.
      category: (worst.severity === "LOW" ? "Signals" : "Waiting on you") as Category,
      occurredAt: oldestAt,
      age: oldest,
      severity: (worst.severity === "HIGH"
        ? "high"
        : worst.severity === "MEDIUM"
          ? "medium"
          : "low") as Severity,
      // Straight to the organisation this is about — using the NGO's own id,
      // which is not the alert's entityId when the alert points at a milestone
      // or a project. The queue is the fallback when nothing resolved.
      href: org ? `/admin/ngos/${org.ngoId}` : "/admin/risk-compliance",
    };

    if (group.length === 1) {
      const only = group[0];
      return {
        ...common,
        id: `alert-${only.id}`,
        // Name the organisation first when it is known. Several NGOs can trip
        // the same defect, so leading with the defect text made distinct
        // problems render as identical rows with nowhere to go.
        title: orgName || defect(only),
        subtitle: orgName
          ? `${defect(only)} — open ${oldest}d`
          : `${only.type.replace(/_/g, " ")} · ${only.severity} severity — open ${oldest}d`,
      };
    }

    // Worst first, so a truncated list never hides the most serious defect.
    const ordered = [...group].sort(
      (a, b) => (ALERT_SEVERITY_RANK[a.severity] ?? 3) - (ALERT_SEVERITY_RANK[b.severity] ?? 3)
    );
    const details = ordered.slice(0, MAX_DETAIL_LINES).map(defect);
    if (ordered.length > MAX_DETAIL_LINES) {
      details.push(`+${ordered.length - MAX_DETAIL_LINES} more`);
    }

    return {
      ...common,
      id: `alerts-${entityId}`,
      title: orgName || `${group.length} alerts on one record`,
      subtitle: `${group.length} open alerts · worst ${worst.severity.toLowerCase()} — oldest ${oldest}d`,
      details,
    };
  });
}

export function buildInboxItems(s: InboxSources, now: number = Date.now()): InboxItem[] {
  const age = (d: Date) => daysSince(d, now);

  return [
    ...s.pendingNgos.map((n): InboxItem => ({
      id: `ngo-${n.id}`,
      queue: "NGO Verification",
      category: "Waiting on you",
      iconKey: "ngo",
      title: n.orgName,
      subtitle: `Awaiting verification — waiting ${age(n.createdAt)}d`,
      occurredAt: n.createdAt,
      age: age(n.createdAt),
      severity: age(n.createdAt) > 5 ? "high" : "medium",
      href: "/admin/dashboard",
    })),
    ...s.submittedOpportunities.map((o): InboxItem => ({
      id: `opportunity-${o.id}`,
      queue: "Opportunity approvals",
      category: "Waiting on you",
      iconKey: "opportunity",
      title: o.title,
      subtitle: `${o.funderName} — submitted, awaiting review ${age(o.createdAt)}d`,
      occurredAt: o.createdAt,
      age: age(o.createdAt),
      severity: age(o.createdAt) > 3 ? "medium" : "low",
      href: `/admin/opportunities/${o.id}`,
    })),
    ...s.pendingProjects.map((p): InboxItem => ({
      id: `project-${p.id}`,
      queue: "Project Review",
      category: "Waiting on you",
      iconKey: "project",
      title: p.title,
      subtitle: `${p.ngo.orgName} — waiting ${age(p.createdAt)}d`,
      occurredAt: p.createdAt,
      age: age(p.createdAt),
      severity: age(p.createdAt) > 3 ? "medium" : "low",
      href: "/admin/project-review",
    })),
    ...s.completedProjects.map((p): InboxItem => ({
      id: `completed-${p.id}`,
      queue: "Project Completions",
      category: "Waiting on you",
      iconKey: "completed",
      title: p.title,
      subtitle: `${p.ngo.orgName} — finished ${age(p.updatedAt)}d ago, awaiting close-out`,
      occurredAt: p.updatedAt,
      age: age(p.updatedAt),
      severity: age(p.updatedAt) > 7 ? "medium" : "low",
      href: "/admin/project-review",
    })),
    ...s.openProposals.map((p): InboxItem => {
      // A proposal already taken up reads differently from one nobody has
      // touched: the second is a queue, the first is somebody's open task.
      const at = p.submittedAt ?? p.createdAt;
      const underReview = p.status === "UNDER_REVIEW";
      return {
        id: `proposal-${p.id}`,
        queue: "Proposal Review",
        category: "Waiting on you",
        iconKey: "proposal",
        title: p.title,
        subtitle: `${p.ngo.orgName} · ${p.opportunity.title} — ${
          underReview ? "under review" : "awaiting review"
        } ${age(at)}d`,
        occurredAt: at,
        age: age(at),
        severity: age(at) > 5 ? "high" : age(at) > 2 ? "medium" : "low",
        href: `/admin/proposals/${p.id}`,
      };
    }),
    ...s.pendingProofs.map((m): InboxItem => ({
      id: `proof-${m.id}`,
      queue: "Proof Review",
      category: "Waiting on you",
      iconKey: "proof",
      title: m.title,
      subtitle: `${m.project.ngo.orgName} · ${m.project.title} — waiting ${age(m.updatedAt)}d`,
      occurredAt: m.updatedAt,
      age: age(m.updatedAt),
      severity: age(m.updatedAt) > 3 ? "medium" : "low",
      href: "/admin/proof-review",
    })),
    ...s.pendingFcra.map((c): InboxItem => ({
      id: `fcra-${c.id}`,
      queue: "FCRA Review",
      category: "Waiting on you",
      iconKey: "fcra",
      title: c.ngo.orgName,
      subtitle: `FCRA certificate awaiting review — waiting ${age(c.updatedAt)}d`,
      occurredAt: c.updatedAt,
      age: age(c.updatedAt),
      severity: age(c.updatedAt) > 5 ? "medium" : "low",
      href: "/admin/fcra-review",
    })),
    ...collapseCandidatesByJob(s.proposedCandidates, age),
    ...s.openRiskReviews.map((r): InboxItem => ({
      id: `risk-${r.id}`,
      queue: "Risk Review",
      category: "Waiting on you",
      iconKey: "risk",
      title: r.ngo.orgName,
      subtitle: `${r.riskLevel} risk · ${r.status} — open ${age(r.createdAt)}d`,
      occurredAt: r.createdAt,
      age: age(r.createdAt),
      severity: r.riskLevel === "CRITICAL" || r.riskLevel === "HIGH" ? "high" : "medium",
      href: "/admin/risk-compliance",
    })),
    ...collapseAlertsByEntity(s.openAlerts, s.alertNgos ?? {}, age),
    ...s.threadsNeedingReply.map((t): InboxItem => ({
      id: `thread-${t.id}`,
      queue: "Inquiries & Appeals",
      category: "Waiting on you",
      iconKey: "thread",
      title: t.subject,
      subtitle: `${t.subjectType} replied — waiting ${age(t.updatedAt)}d`,
      occurredAt: t.updatedAt,
      age: age(t.updatedAt),
      severity: age(t.updatedAt) > 2 ? "medium" : "low",
      href: "/admin/inquiries",
    })),
    ...s.quietNgos.map((n): InboxItem => ({
      id: `quiet-${n.id}`,
      queue: "Impact Health",
      category: "Signals",
      iconKey: "quiet",
      title: n.orgName,
      subtitle: "No donor update shared in 30+ days",
      // Quietness is a standing condition with no event behind it, so it has
      // no arrival time — dated to the edge of the window it describes, which
      // keeps it from ever counting as "new".
      occurredAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
      age: 30,
      severity: "low",
      href: "/admin/impact-health",
    })),
    ...s.overdueMilestones.map((m): InboxItem => ({
      id: `overdue-${m.id}`,
      queue: "Impact Health",
      category: "Waiting on others",
      iconKey: "overdue",
      title: m.title,
      subtitle: `${m.project.ngo.orgName} · ${m.project.title} — ${age(m.deadline)}d overdue`,
      occurredAt: m.deadline,
      age: age(m.deadline),
      severity: age(m.deadline) > 7 ? "high" : "medium",
      href: "/admin/impact-health",
    })),
  ];
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Queues present in the inbox, busiest first, for the filter bar.
 *
 * Derived from the items rather than hardcoded, so a queue with nothing
 * waiting never offers a chip that leads to an empty page.
 */
export function countByQueue(items: InboxItem[]): { queue: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.queue, (counts.get(i.queue) ?? 0) + 1);
  return Array.from(counts, ([queue, count]) => ({ queue, count })).sort(
    (a, b) => b.count - a.count || a.queue.localeCompare(b.queue)
  );
}

/**
 * Items past the target their queue declares in lib/sla.ts.
 *
 * Kept separate from `severity`: severity is how bad a thing is, a breach is
 * how late we are with it. A LOW fraud alert three days over target is not
 * suddenly serious, but it is a promise we have broken, and collapsing the two
 * would lose one of those facts.
 */
export function isBreached(item: InboxItem): boolean {
  return slaState(item.queue, item.age) === "breached";
}

export function breachedItems(items: InboxItem[]): InboxItem[] {
  // Worst overrun first — the oldest broken promise is the one to answer for.
  return items
    .filter(isBreached)
    .sort((a, b) => (daysOverTarget(b.queue, b.age) ?? 0) - (daysOverTarget(a.queue, a.age) ?? 0));
}

/** Breach counts per queue, for the SLA summary. */
export function breachesByQueue(items: InboxItem[]): { queue: string; count: number; worst: number }[] {
  const byQueue = new Map<string, { count: number; worst: number }>();
  for (const i of breachedItems(items)) {
    const over = daysOverTarget(i.queue, i.age) ?? 0;
    const existing = byQueue.get(i.queue);
    if (existing) {
      existing.count++;
      existing.worst = Math.max(existing.worst, over);
    } else {
      byQueue.set(i.queue, { count: 1, worst: over });
    }
  }
  return Array.from(byQueue, ([queue, v]) => ({ queue, ...v })).sort(
    (a, b) => b.worst - a.worst || b.count - a.count
  );
}

/**
 * Only work somebody else owes can be chased. Chasing something the admin owes
 * would just be hiding their own queue from themselves.
 */
export function isChaseable(item: InboxItem): boolean {
  return item.category === "Waiting on others";
}

/** How long a nudge buys before the item comes back if still unresolved. */
export const CHASE_WINDOW_DAYS = 7;

export function chaseExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + CHASE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Split an already-sorted list into the items still wanting a nudge and the
 * ones already chased.
 *
 * Chased items are kept, not dropped. Hiding them outright would leave no way
 * to undo a mistaken tick, and something vanishing the instant you touch it is
 * how work gets lost. The page renders them last and dimmed instead.
 *
 * Expired chases are simply absent from `activeChaseKeys` — the caller filters
 * on expiry when reading, so an item whose window ran out returns on its own
 * without anything having to clean the row up.
 */
export function partitionByChase(
  items: InboxItem[],
  activeChaseKeys: Set<string>
): { pending: InboxItem[]; chased: InboxItem[] } {
  const pending: InboxItem[] = [];
  const chased: InboxItem[] = [];
  for (const i of items) (activeChaseKeys.has(i.id) ? chased : pending).push(i);
  return { pending, chased };
}

/**
 * What earns a place on Today, as opposed to living in its own queue.
 *
 * Today was showing every open item anywhere, which made it a backlog: the
 * same fortnight-old rows every morning, so the counts never moved and stopped
 * meaning anything. An item belongs here if it is NEW since this admin last
 * looked, or if it is urgent enough that age should not bury it.
 *
 * Severity is the urgency test rather than a second age rule, because the
 * severity bands already encode "this has waited too long" for each queue.
 */
export function isTodayWorthy(item: InboxItem, newSince: Date): boolean {
  return item.severity === "high" || item.occurredAt.getTime() > newSince.getTime();
}

/**
 * Split into what Today should show and what it should merely count.
 *
 * Nothing is dropped — the caller reports the remainder per queue, so work
 * that falls out of Today is still visibly waiting somewhere.
 */
export function splitTodayAndOlder(
  items: InboxItem[],
  newSince: Date
): { today: InboxItem[]; older: InboxItem[] } {
  const today: InboxItem[] = [];
  const older: InboxItem[] = [];
  for (const i of items) (isTodayWorthy(i, newSince) ? today : older).push(i);
  return { today, older };
}

/**
 * Two visits inside this window count as one, so refreshing the page does not
 * instantly mark everything as already-seen.
 */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** First-ever visit: fall back to a week so Today is not empty on day one. */
export const FIRST_VISIT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Narrow to one queue. An unknown or absent queue means "everything". */
export function filterByQueue(items: InboxItem[], queue?: string): InboxItem[] {
  if (!queue) return items;
  return items.filter((i) => i.queue === queue);
}

export function countBySeverity(items: InboxItem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const i of items) counts[i.severity]++;
  return counts;
}

/**
 * Categories in fixed order, most severe then oldest first within each.
 *
 * Every category is returned even when empty: these render as side-by-side
 * columns, and dropping an empty one would shuffle the remaining columns to
 * different positions between page loads. An empty column says "nothing owed
 * here", which is itself worth seeing.
 */
export function groupByCategory(items: InboxItem[]): { category: Category; items: InboxItem[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: items
      .filter((i) => i.category === category)
      .sort((a, b) => {
        if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
          return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        }
        return b.age - a.age;
      }),
  }));
}
