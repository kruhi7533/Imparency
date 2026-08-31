import { getServerSession } from "next-auth/next";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ListChecks,
  ShieldCheck,
  FolderKanban,
  ImageIcon,
  FileWarning,
  AlertTriangle,
  ShieldAlert,
  BellOff,
  CalendarClock,
  MessageCircleQuestion,
} from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

type Severity = "high" | "medium" | "low";

interface InboxItem {
  id: string;
  queue: string;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  age: number; // days — used for sorting, oldest first within a severity band
  severity: Severity;
  href: string;
}

const SEVERITY_STYLE: Record<Severity, { label: string; classes: string }> = {
  high: { label: "Needs attention", classes: "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30" },
  medium: { label: "Worth a look", classes: "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30" },
  low: { label: "FYI", classes: "bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30" },
};

/**
 * Unified admin inbox — a read-only aggregation over queues that already
 * exist elsewhere (NGO verification, project/proof/FCRA review, fraud alerts,
 * risk reviews, quiet NGOs, overdue milestones, inquiry threads).
 *
 * INVARIANT: this page must never write anything and must never be the only
 * place an item can be actioned — every card links out to its real queue.
 * That keeps it purely additive: nothing here can break something else.
 */
export default async function TodayInboxPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  let data;
  try {
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
    ).map((e) => e.projectId);

    data = await Promise.all([
      prisma.nGOProfile.findMany({
        where: { verificationStatus: "PENDING" },
        select: { id: true, orgName: true, createdAt: true },
      }),
      prisma.project.findMany({
        where: { status: "PENDING_APPROVAL" },
        select: { id: true, title: true, createdAt: true, ngo: { select: { orgName: true } } },
      }),
      prisma.milestone.findMany({
        where: { status: "PROOF_SUBMITTED" },
        select: { id: true, title: true, updatedAt: true, project: { select: { title: true, ngo: { select: { orgName: true } } } } },
      }),
      prisma.nGOCompliance.findMany({
        where: { fcraStatus: "PENDING" },
        select: { id: true, updatedAt: true, ngo: { select: { id: true, orgName: true } } },
      }),
      prisma.fraudAlert.findMany({
        where: { resolved: false },
        select: { id: true, type: true, severity: true, createdAt: true, entityType: true },
      }),
      prisma.riskReview.findMany({
        where: { status: { in: ["OPEN", "ESCALATED"] } },
        select: { id: true, riskLevel: true, status: true, createdAt: true, ngo: { select: { orgName: true } } },
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
          projects: {
            some: {
              status: "ACTIVE",
              id: { notIn: recentlyActiveProjectIds },
            },
          },
        },
        select: { id: true, orgName: true },
      }),
      // Overdue milestones — same check as the reminder cron / Impact Health
      prisma.milestone.findMany({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] }, deadline: { lt: now } },
        select: { id: true, title: true, deadline: true, project: { select: { title: true, ngo: { select: { orgName: true } } } } },
      }),
    ]);
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Today Inbox failed to load" detail={err?.meta?.table || err?.meta?.column || err?.message} />;
    }
    throw err;
  }

  const [
    pendingNgos,
    pendingProjects,
    pendingProofs,
    pendingFcra,
    openAlerts,
    openRiskReviews,
    threadsNeedingReply,
    quietNgos,
    overdueMilestones,
  ] = data;

  const items: InboxItem[] = [
    ...pendingNgos.map((n): InboxItem => ({
      id: `ngo-${n.id}`,
      queue: "NGO Verification",
      icon: ShieldCheck,
      title: n.orgName,
      subtitle: `Awaiting verification — waiting ${daysSince(n.createdAt)}d`,
      age: daysSince(n.createdAt),
      severity: daysSince(n.createdAt) > 5 ? "high" : "medium",
      href: "/admin/dashboard",
    })),
    ...pendingProjects.map((p): InboxItem => ({
      id: `project-${p.id}`,
      queue: "Project Review",
      icon: FolderKanban,
      title: p.title,
      subtitle: `${p.ngo.orgName} — waiting ${daysSince(p.createdAt)}d`,
      age: daysSince(p.createdAt),
      severity: daysSince(p.createdAt) > 3 ? "medium" : "low",
      href: "/admin/project-review",
    })),
    ...pendingProofs.map((m): InboxItem => ({
      id: `proof-${m.id}`,
      queue: "Proof Review",
      icon: ImageIcon,
      title: m.title,
      subtitle: `${m.project.ngo.orgName} · ${m.project.title} — waiting ${daysSince(m.updatedAt)}d`,
      age: daysSince(m.updatedAt),
      severity: daysSince(m.updatedAt) > 3 ? "medium" : "low",
      href: "/admin/proof-review",
    })),
    ...pendingFcra.map((c): InboxItem => ({
      id: `fcra-${c.id}`,
      queue: "FCRA Review",
      icon: FileWarning,
      title: c.ngo.orgName,
      subtitle: `FCRA certificate awaiting review — waiting ${daysSince(c.updatedAt)}d`,
      age: daysSince(c.updatedAt),
      severity: daysSince(c.updatedAt) > 5 ? "medium" : "low",
      href: "/admin/fcra-review",
    })),
    ...openAlerts.map((a): InboxItem => ({
      id: `alert-${a.id}`,
      queue: "Fraud Alerts",
      icon: AlertTriangle,
      title: a.type.replace(/_/g, " "),
      subtitle: `${a.entityType} · ${a.severity} severity — open ${daysSince(a.createdAt)}d`,
      age: daysSince(a.createdAt),
      severity: a.severity === "HIGH" ? "high" : a.severity === "MEDIUM" ? "medium" : "low",
      href: "/admin/risk-compliance",
    })),
    ...openRiskReviews.map((r): InboxItem => ({
      id: `risk-${r.id}`,
      queue: "Risk Review",
      icon: ShieldAlert,
      title: r.ngo.orgName,
      subtitle: `${r.riskLevel} risk · ${r.status} — open ${daysSince(r.createdAt)}d`,
      age: daysSince(r.createdAt),
      severity: r.riskLevel === "CRITICAL" || r.riskLevel === "HIGH" ? "high" : "medium",
      href: "/admin/risk-compliance",
    })),
    ...threadsNeedingReply.map((t): InboxItem => ({
      id: `thread-${t.id}`,
      queue: "Inquiries & Appeals",
      icon: MessageCircleQuestion,
      title: t.subject,
      subtitle: `${t.subjectType} replied — waiting ${daysSince(t.updatedAt)}d`,
      age: daysSince(t.updatedAt),
      severity: daysSince(t.updatedAt) > 2 ? "medium" : "low",
      href: "/admin/inquiries",
    })),
    ...quietNgos.map((n): InboxItem => ({
      id: `quiet-${n.id}`,
      queue: "Impact Health",
      icon: BellOff,
      title: n.orgName,
      subtitle: "No donor update shared in 30+ days",
      age: 30,
      severity: "low",
      href: "/admin/impact-health",
    })),
    ...overdueMilestones.map((m): InboxItem => ({
      id: `overdue-${m.id}`,
      queue: "Impact Health",
      icon: CalendarClock,
      title: m.title,
      subtitle: `${m.project.ngo.orgName} · ${m.project.title} — ${daysSince(m.deadline)}d overdue`,
      age: daysSince(m.deadline),
      severity: daysSince(m.deadline) > 7 ? "high" : "medium",
      href: "/admin/impact-health",
    })),
  ];

  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const i of items) bySeverity[i.severity]++;

  const sorted = [...items].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return b.age - a.age; // oldest first within the same severity
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <ListChecks size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Today</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
              Everything that needs your attention, from every queue, in one place — oldest and most
              important first. Nothing is actioned here; each item takes you to where you already work.
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="flex gap-3 flex-wrap">
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold border ${SEVERITY_STYLE.high.classes}`}>
            {bySeverity.high} needs attention
          </span>
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold border ${SEVERITY_STYLE.medium.classes}`}>
            {bySeverity.medium} worth a look
          </span>
          <span className={`px-3 py-1.5 rounded-full text-sm font-bold border ${SEVERITY_STYLE.low.classes}`}>
            {bySeverity.low} FYI
          </span>
        </div>

        {/* List */}
        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Nothing waiting on you right now. Every queue is caught up. 🎉
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {sorted.map((item) => {
              const Icon = item.icon;
              const style = SEVERITY_STYLE[item.severity];
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-900/40 transition"
                  >
                    <div className="h-9 w-9 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
                      <Icon size={17} strokeWidth={2.2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">{item.queue}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${style.classes}`}>{style.label}</span>
                      </div>
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{item.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.subtitle}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
