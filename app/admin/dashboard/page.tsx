import { unstable_cache } from "next/cache";
import { getServerSession } from "next-auth/next";
import {
  IndianRupee,
  ShieldCheck,
  Megaphone,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  Wallet,
  CalendarDays,
  ArrowRight,
  MoreHorizontal,
  Database,
  HardDrive,
  Cpu,
  CreditCard,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import CountUp from "@/app/admin/components/CountUp";
import CoverThumb from "./CoverThumb";
import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { adminPageAllowed } from "@/lib/admin-roles";
import { formatCompactINR } from "@/lib/format-currency";
import { loadVerificationQueue } from "@/lib/verification-queue";
import { judgeSignals, loadPilotSignals, type Level } from "@/lib/pilot-health";
import { GroupedBarChart, Donut, DONUT_COLORS, type MonthBar } from "./charts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cache tag for the statistics block below. Deliberately NOT exported: a
 * `page.tsx` may only export Next's own reserved names.
 */
const DASHBOARD_METRICS_TAG = "admin-dashboard-metrics";

const MONTHS = 6;

/**
 * The dashboard's read-only statistics, cached for a minute.
 *
 * The rule: **cache anything an admin cannot make stale by an action taken on
 * this page.** The verification queue, NGO status counts and fraud alerts stay
 * live (see loadDashboardData) — a queue that still lists an NGO you just
 * approved is a bug, and a badge reading "0 HIGH" when there are three is false
 * reassurance.
 *
 * Everything crossing the cache boundary is converted to a plain number first:
 * Prisma's `Decimal` does not survive serialization.
 */
const getDashboardMetrics = unstable_cache(
  async () => {
    const now = new Date();
    const y = now.getFullYear();
    const startOfToday = new Date(y, now.getMonth(), now.getDate());
    const startOfWeek = new Date(y, now.getMonth(), now.getDate() - now.getDay());
    const startOfMonth = new Date(y, now.getMonth(), 1);
    const startOfLastMonth = new Date(y, now.getMonth() - 1, 1);
    const startOfFY = now.getMonth() >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);
    const seriesStart = new Date(y, now.getMonth() - (MONTHS - 1), 1);

    const sum = (where: object) => prisma.donation.aggregate({ where: { status: "SUCCESS", ...where }, _sum: { amount: true } });

    const [
      donationsToday,
      donationsWeek,
      donationsMonth,
      donationsLastMonth,
      donationsFY,
      totalMilestonesCount,
      completedMilestonesCount,
      seriesDonations,
      seriesPayments,
      sectorRows,
    ] = await Promise.all([
      sum({ createdAt: { gte: startOfToday } }),
      sum({ createdAt: { gte: startOfWeek } }),
      sum({ createdAt: { gte: startOfMonth } }),
      sum({ createdAt: { gte: startOfLastMonth, lt: startOfMonth } }),
      sum({ createdAt: { gte: startOfFY } }),
      prisma.milestone.count(),
      prisma.milestone.count({ where: { status: { in: ["COMPLETED", "VERIFIED"] } } }),
      prisma.donation.findMany({
        where: { status: "SUCCESS", createdAt: { gte: seriesStart } },
        select: { amount: true, createdAt: true },
      }),
      prisma.contractPayment.findMany({
        where: { paidAt: { gte: seriesStart }, status: { in: ["RECONCILED", "PENDING_CONFIRMATION"] } },
        select: { amount: true, paidAt: true, status: true },
      }),
      prisma.nGOProfile.findMany({
        where: { verificationStatus: "VERIFIED", isDeleted: false },
        select: { causeCategories: true },
      }),
    ]);

    const months: MonthBar[] = [];
    for (let i = 0; i < MONTHS; i++) {
      const d = new Date(seriesStart.getFullYear(), seriesStart.getMonth() + i, 1);
      months.push({
        label: d.toLocaleDateString("en-IN", { month: "short" }),
        long: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
        a: 0,
        b: 0,
      });
    }
    const idx = (d: Date) => (d.getFullYear() - seriesStart.getFullYear()) * 12 + d.getMonth() - seriesStart.getMonth();
    for (const r of seriesDonations) {
      const i = idx(r.createdAt);
      if (i >= 0 && i < MONTHS) months[i].a += Number(r.amount);
    }
    for (const r of seriesPayments) {
      const i = idx(r.paidAt);
      if (i < 0 || i >= MONTHS) continue;
      if (r.status === "RECONCILED") months[i].a += Number(r.amount);
      else months[i].b += Number(r.amount);
    }

    const sectorCounts = new Map<string, number>();
    for (const n of sectorRows) {
      for (const c of Array.from(new Set((n.causeCategories ?? []).map((x) => x.trim()).filter(Boolean)))) {
        sectorCounts.set(c, (sectorCounts.get(c) ?? 0) + 1);
      }
    }
    const sorted = Array.from(sectorCounts.entries()).sort((a, b) => b[1] - a[1]);
    const sectors = sorted.slice(0, 5).map(([label, value]) => ({ label, value }));
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) sectors.push({ label: "Other", value: rest });

    return {
      sumToday: Number(donationsToday._sum.amount || 0),
      sumWeek: Number(donationsWeek._sum.amount || 0),
      sumMonth: Number(donationsMonth._sum.amount || 0),
      sumLastMonth: Number(donationsLastMonth._sum.amount || 0),
      sumFY: Number(donationsFY._sum.amount || 0),
      totalMilestonesCount,
      completedMilestonesCount,
      months,
      sectors,
      verifiedNgoCount: sectorRows.length,
    };
  },
  [DASHBOARD_METRICS_TAG, "v2"],
  { revalidate: 60, tags: [DASHBOARD_METRICS_TAG] }
);

type QueueStatus = "Re-verification" | "Documents" | "Identity check" | "Resubmitted" | "Pending";

function storageCheck(): { ok: boolean | null; text: string } {
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (provider === "cloudinary") {
    const ok = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
    return { ok, text: ok ? "Cloudinary configured" : "Cloudinary selected but credentials missing" };
  }
  if (provider === "s3" || provider === "r2") {
    const ok = !!process.env.AWS_BUCKET_NAME;
    return { ok, text: ok ? `${provider.toUpperCase()} bucket configured` : `${provider.toUpperCase()} selected but no bucket set` };
  }
  const prod = process.env.NODE_ENV === "production";
  return { ok: prod ? null : true, text: prod ? "Local disk in production — files may not persist" : "Local disk (development)" };
}

async function loadDashboardData() {
  const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      console.error("[admin-dashboard] widget failed:", err);
      return null;
    }
  };

  const dbStart = Date.now();
  const [
    metrics,
    activeNGOsCount,
    pendingNGOsCount,
    rejectedNGOsCount,
    fraudBySeverity,
    openRiskReviews,
    recentAlerts,
    activeProjects,
    pendingProjects,
    queue,
    logs,
    topCampaigns,
  ] = await Promise.all([
    getDashboardMetrics(),
    prisma.nGOProfile.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.nGOProfile.count({ where: { verificationStatus: "PENDING" } }),
    prisma.nGOProfile.count({ where: { verificationStatus: "REJECTED" } }),
    prisma.fraudAlert.groupBy({ by: ["severity"], where: { resolved: false }, _count: { _all: true } }),
    prisma.riskReview.count({ where: { status: "OPEN" } }),
    prisma.fraudAlert.findMany({
      where: { resolved: false },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, type: true, severity: true, description: true, entityType: true, createdAt: true },
    }),
    prisma.project.count({ where: { status: "ACTIVE", isDeleted: false } }),
    prisma.project.count({ where: { status: "PENDING_APPROVAL", isDeleted: false } }),
    loadVerificationQueue(),
    safe(() =>
      prisma.adminActionLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, admin: { select: { name: true } } },
      })
    ),
    prisma.project.findMany({
      where: { isDeleted: false, status: { in: ["ACTIVE", "COMPLETED"] }, raisedAmount: { gt: 0 } },
      orderBy: { raisedAmount: "desc" },
      take: 4,
      select: { id: true, title: true, coverImage: true, raisedAmount: true, targetAmount: true, causeCategory: true, ngo: { select: { orgName: true } } },
    }),
  ]);
  const dbMs = Date.now() - dbStart;

  // Names for the activity feed. Ids only live in the audit log (Privacy rule),
  // so the display name is looked up live from the entity itself.
  const ngoIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const l of logs ?? []) {
    if (l.entityType === "NGO") ngoIds.add(l.entityId);
    if (l.entityType === "PROJECT") projectIds.add(l.entityId);
  }
  const queueTop = queue.slice(0, 5);
  const [ngoNames, projectNames, responded, signals, deadLetters, dbPing] = await Promise.all([
    ngoIds.size ? prisma.nGOProfile.findMany({ where: { id: { in: Array.from(ngoIds) } }, select: { id: true, orgName: true } }) : [],
    projectIds.size ? prisma.project.findMany({ where: { id: { in: Array.from(projectIds) } }, select: { id: true, title: true } }) : [],
    queueTop.length
      ? prisma.reviewThread.findMany({
          where: { subjectType: "NGO", subjectId: { in: queueTop.map((n: any) => n.id) }, status: "NGO_RESPONDED" },
          select: { subjectId: true },
        })
      : [],
    safe(() => loadPilotSignals()),
    safe(() => prisma.deadLetter.count({ where: { status: "OPEN" } })),
    safe(async () => {
      const t = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return Date.now() - t;
    }),
  ]);

  const nameOf = new Map<string, string>();
  for (const n of ngoNames) nameOf.set(n.id, n.orgName);
  for (const p of projectNames) nameOf.set(p.id, p.title);
  const respondedIds = new Set(responded.map((r) => r.subjectId));

  const queueRows = queueTop.map((n: any) => {
    let status: QueueStatus = "Pending";
    if (n.reverificationRequiredAt) status = "Re-verification";
    else if (!n.hasDocuments || !n.hasExtraction) status = "Documents";
    else if (n.hasIdentityContradiction) status = "Identity check";
    else if (respondedIds.has(n.id)) status = "Resubmitted";
    const parts = String(n.address ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    return {
      id: n.id as string,
      orgName: n.orgName as string,
      location: parts.slice(-2).join(", ") || "—",
      submitted: n.createdAt as Date,
      status,
    };
  });

  const sev = (s: string) => fraudBySeverity.find((r) => r.severity === s)?._count._all ?? 0;

  return {
    metrics,
    activeNGOsCount,
    pendingNGOsCount,
    rejectedNGOsCount,
    fraud: { high: sev("HIGH"), medium: sev("MEDIUM"), low: sev("LOW") },
    openRiskReviews,
    recentAlerts,
    activeProjects,
    pendingProjects,
    queueTotal: queue.length,
    queueRows,
    activity: (logs ?? []).map((l) => ({ ...l, entityName: nameOf.get(l.entityId) ?? null })),
    activityFailed: logs === null,
    topCampaigns: topCampaigns.map((p) => ({
      ...p,
      raised: Number(p.raisedAmount),
      target: Number(p.targetAmount),
    })),
    health: { signals, deadLetters, dbPing: dbPing ?? null, dbMs, storage: storageCheck() },
  };
}

/* ────────────────────────── presentation helpers ────────────────────────── */

const CARD = "rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]";

function relTime(d: Date): string {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const ACRONYMS = new Set(["NGO", "FCRA", "PAN", "CSR", "AI", "KYC", "UTR", "SLA", "ID", "GPS", "RFP", "80G", "12A"]);
function humanAction(a: string): string {
  return a
    .split("_")
    .filter(Boolean)
    .map((w, i) => (ACRONYMS.has(w) ? w : i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

function actionStyle(a: string): { icon: LucideIcon; tone: string } {
  if (/REJECT|SUSPEND|BLOCK|REVOK|DISPUT|TERMINAT/.test(a)) return { icon: XCircle, tone: "bg-red-50 text-red-600" };
  if (/ALERT|RISK|FRAUD|ESCALAT|REVERIF/.test(a)) return { icon: AlertTriangle, tone: "bg-amber-50 text-amber-600" };
  if (/PAYMENT|DISBURS|ALLOC|FINANCE|LEDGER|REFUND|RECONCIL/.test(a)) return { icon: Wallet, tone: "bg-emerald-50 text-emerald-600" };
  if (/APPROV|VERIF|VALIDAT|PUBLISH|RESOLV|ACCEPT/.test(a)) return { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" };
  return { icon: Activity, tone: "bg-trust-50 text-trust-600" };
}

const STATUS_PILL: Record<QueueStatus, string> = {
  "Re-verification": "bg-red-50 text-red-700 ring-red-200",
  Documents: "bg-amber-50 text-amber-700 ring-amber-200",
  "Identity check": "bg-violet-50 text-violet-700 ring-violet-200",
  Resubmitted: "bg-sky-50 text-sky-700 ring-sky-200",
  Pending: "bg-gray-100 text-gray-700 ring-gray-200",
};

const SEVERITY_PILL: Record<string, string> = {
  HIGH: "bg-red-50 text-red-700 ring-red-200",
  MEDIUM: "bg-amber-50 text-amber-700 ring-amber-200",
  LOW: "bg-gray-100 text-gray-700 ring-gray-200",
};

const LEVEL_DOT: Record<Level, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" };
const LEVEL_TEXT: Record<Level, string> = { green: "text-emerald-700", amber: "text-amber-700", red: "text-red-700" };

function CardHeader({ title, sub, href, linkLabel = "View all" }: { title: string; sub?: string; href?: string | null; linkLabel?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
      </div>
      {href && (
        <a href={href} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-trust-700 hover:text-trust-800">
          {linkLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  icon: LucideIcon;
  tone: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-600">{label}</p>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${tone}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-gray-900">{value}</p>
      <div className="mt-3 text-xs text-gray-600">{sub}</div>
    </>
  );
  const cls = `${CARD} block p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none`;
  return href ? (
    <a href={href} className={cls}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

const AVATAR_TONES = ["bg-trust-50 text-trust-700", "bg-emerald-50 text-emerald-700", "bg-amber-50 text-amber-700", "bg-violet-50 text-violet-700", "bg-sky-50 text-sky-700"];

/* ─────────────────────────────────── page ─────────────────────────────────── */

export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.adminRole ?? null;
  let data: Awaited<ReturnType<typeof loadDashboardData>>;
  try {
    data = await loadDashboardData();
  } catch (err: any) {
    return <SchemaOutOfSync title="Dashboard failed to load" detail={err?.message ?? String(err)} />;
  }

  const { metrics: m } = data;
  const firstName = (session?.user?.name ?? "").trim() || "Admin";
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

  const monthDelta = m.sumLastMonth > 0 ? Math.round(((m.sumMonth - m.sumLastMonth) / m.sumLastMonth) * 100) : null;
  const unresolvedAlerts = data.fraud.high + data.fraud.medium + data.fraud.low;
  const milestoneRate = m.totalMilestonesCount > 0 ? Math.round((m.completedMilestonesCount / m.totalMilestonesCount) * 100) : null;
  const chartHasData = m.months.some((x) => x.a > 0 || x.b > 0);
  const seriesTotalA = m.months.reduce((s, x) => s + x.a, 0);
  const seriesTotalB = m.months.reduce((s, x) => s + x.b, 0);

  // Platform health checklist
  const verdict = data.health.signals ? judgeSignals(data.health.signals) : null;
  const sig = (k: string) => verdict?.signals.find((s) => s.key === k);
  const jobs = sig("jobs");
  const pay = sig("payments24h");
  const hook = data.health.signals?.lastWebhookAt ?? null;
  const checks: { label: string; icon: LucideIcon; level: Level; text: string; href?: string }[] = [
    {
      label: "Database",
      icon: Database,
      level: data.health.dbPing === null ? "red" : data.health.dbPing > 1500 ? "amber" : "green",
      text: data.health.dbPing === null ? "Not reachable" : `Responding · ${data.health.dbPing} ms`,
    },
    {
      label: "File storage",
      icon: HardDrive,
      level: data.health.storage.ok === true ? "green" : data.health.storage.ok === false ? "red" : "amber",
      text: data.health.storage.text,
    },
    {
      label: "Background jobs",
      icon: Cpu,
      level: jobs?.level ?? "amber",
      text: jobs?.text ?? "Could not be read",
      href: "/admin/ops",
    },
    {
      label: "Payments API",
      icon: CreditCard,
      level: pay?.level ?? "amber",
      text: pay ? `${pay.text}${hook ? ` · last webhook ${relTime(new Date(hook))}` : ""}` : "Could not be read",
      href: "/admin/finance",
    },
    {
      label: "Dead letters",
      icon: Inbox,
      level: data.health.deadLetters === null ? "amber" : data.health.deadLetters > 0 ? "amber" : "green",
      text: data.health.deadLetters === null ? "Could not be read" : data.health.deadLetters === 0 ? "None open" : `${data.health.deadLetters} open`,
      href: "/admin/dead-letters",
    },
  ];
  const attention = checks.filter((c) => c.level !== "green").length;
  const worst: Level = checks.some((c) => c.level === "red") ? "red" : attention ? "amber" : "green";
  const can = (href: string) => adminPageAllowed(role, href);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 sm:text-[34px]">Welcome back, {firstName}</h1>
          <p className="mt-1.5 text-sm text-gray-600">Here’s what’s happening across the platform today — every figure is read live from the database.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <CalendarDays className="h-4 w-4 text-gray-500" aria-hidden /> Today · {today}
        </span>
      </div>

      {/* KPIs */}
      <section aria-label="Key figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-6">
        <Kpi
          label="Financial Year Spend"
          value={<CountUp value={m.sumFY} format="inr" />}
          icon={IndianRupee}
          tone="bg-emerald-50 text-emerald-600"
          sub={
            monthDelta === null ? (
              <>Successful donations this Indian FY</>
            ) : (
              <>
                <span className={monthDelta >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>
                  {monthDelta >= 0 ? "▲" : "▼"} {Math.abs(monthDelta)}%
                </span>{" "}
                this month vs last month
              </>
            )
          }
        />
        <Kpi
          label="Verified NGOs"
          value={<CountUp value={data.activeNGOsCount} />}
          icon={ShieldCheck}
          tone="bg-trust-50 text-trust-600"
          href={can("/admin/ngos") ? "/admin/ngos" : undefined}
          sub={
            <>
              <span className="font-semibold text-amber-700">{data.pendingNGOsCount}</span> awaiting review
            </>
          }
        />
        <Kpi
          label="Active campaigns"
          value={<CountUp value={data.activeProjects} />}
          icon={Megaphone}
          tone="bg-violet-50 text-violet-600"
          href={can("/admin/projects") ? "/admin/projects" : undefined}
          sub={
            <>
              {data.pendingProjects} pending approval
              {milestoneRate !== null && <> · {milestoneRate}% milestones done</>}
            </>
          }
        />
        <Kpi
          label="Open risk alerts"
          value={<CountUp value={unresolvedAlerts} />}
          icon={AlertTriangle}
          tone={unresolvedAlerts > 0 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}
          href={can("/admin/risk-compliance") ? "/admin/risk-compliance" : undefined}
          sub={
            <>
              <span className={data.fraud.high > 0 ? "font-semibold text-red-700" : ""}>{data.fraud.high} high severity</span> ·{" "}
              {data.openRiskReviews} open review{data.openRiskReviews === 1 ? "" : "s"}
            </>
          }
        />
      </section>

      {/* Chart + donut */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className={`${CARD} p-5 sm:p-6 xl:col-span-2`} aria-labelledby="disb-h">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="disb-h" className="text-base font-semibold text-gray-900">
                Funding Disbursement Overview
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">Donations and CSR contract payments, last {MONTHS} months</p>
            </div>
            <dl className="grid grid-cols-3 gap-x-5 gap-y-1 text-right">
              {[
                ["Donations Today", m.sumToday],
                ["This week", m.sumWeek],
                ["This month", m.sumMonth],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-[11px] font-medium text-gray-500">{k}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-gray-900">{formatCompactINR(v as number)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="mt-5">
            {chartHasData ? (
              <>
                <GroupedBarChart data={m.months} seriesA="Received & reconciled" seriesB="Awaiting confirmation" />
                <p className="mt-2 text-xs text-gray-500">
                  {formatCompactINR(Math.round(seriesTotalA))} received · {formatCompactINR(Math.round(seriesTotalB))} awaiting NGO confirmation over the period.
                </p>
              </>
            ) : (
              <EmptyState icon={Wallet} title="No money has moved in the last six months" body="Successful donations and recorded contract payments will chart here by month." />
            )}
          </div>
        </section>

        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="sector-h">
          <h2 id="sector-h" className="text-base font-semibold text-gray-900">
            Impact by Sector
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">Verified NGOs by cause category (an NGO can work in several)</p>
          {m.sectors.length === 0 ? (
            <div className="mt-6">
              <EmptyState icon={ShieldCheck} title="No verified NGOs yet" body="Sectors appear once organisations are verified." />
            </div>
          ) : (
            <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
              <Donut segments={m.sectors} centreValue={String(m.verifiedNgoCount)} centreLabel="verified NGOs" />
              <ul className="w-full space-y-2">
                {m.sectors.map((s, i) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} aria-hidden />
                      <span className="truncate text-gray-700">{s.label}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-gray-900">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Queue + activity */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className={`${CARD} xl:col-span-2`} aria-labelledby="queue-h">
          <div className="p-5 pb-3 sm:p-6 sm:pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="queue-h" className="text-base font-semibold text-gray-900">
                  Verification Queue
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  NGO Registration Status: <span className="font-medium text-emerald-700">{data.activeNGOsCount} verified</span> ·{" "}
                  <span className="font-medium text-amber-700">{data.pendingNGOsCount} pending</span> ·{" "}
                  <span className="font-medium text-red-700">{data.rejectedNGOsCount} rejected</span>
                </p>
              </div>
              {can("/admin/verification") && (
                <a href="/admin/verification" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-trust-700 hover:text-trust-800">
                  View all ({data.queueTotal}) <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          </div>
          {data.queueRows.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState icon={CheckCircle2} title="Queue is clear" body="No organisation is waiting for a verification decision." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50/70 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <th scope="col" className="px-6 py-2.5">NGO</th>
                    <th scope="col" className="px-3 py-2.5">Location</th>
                    <th scope="col" className="px-3 py-2.5">Submitted</th>
                    <th scope="col" className="px-3 py-2.5">Status</th>
                    <th scope="col" className="px-6 py-2.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.queueRows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-gray-50/60">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${AVATAR_TONES[i % AVATAR_TONES.length]}`} aria-hidden>
                            {initialsOf(r.orgName) || "?"}
                          </span>
                          <span className="max-w-[13rem] truncate font-medium text-gray-900">{r.orgName}</span>
                        </div>
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-3 text-gray-600">{r.location}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                        {new Date(r.submitted).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUS_PILL[r.status]}`}>{r.status}</span>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={`/admin/ngos/${r.id}`}
                            className="rounded-lg bg-trust-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-trust-700"
                            aria-label={`Review ${r.orgName}`}
                          >
                            Review
                          </a>
                          <details className="relative">
                            <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-gray-500 hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
                              <MoreHorizontal className="h-4 w-4" aria-hidden />
                              <span className="sr-only">More actions for {r.orgName}</span>
                            </summary>
                            <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-left shadow-lg">
                              <a href="/admin/verification" className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                Open in Approvals
                              </a>
                              <a href="/admin/document-review" className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                                Document review
                              </a>
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="act-h">
          <div className="flex items-start justify-between gap-3">
            <h2 id="act-h" className="text-base font-semibold text-gray-900">
              Recent Activities
            </h2>
            {can("/admin/audit") && (
              <a href="/admin/audit" className="inline-flex items-center gap-1 text-xs font-semibold text-trust-700 hover:text-trust-800">
                View all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </div>
          {data.activity.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                icon={Activity}
                title={data.activityFailed ? "Activity could not be loaded" : "No recorded activity yet"}
                body="Admin decisions and platform actions from the audit trail appear here."
              />
            </div>
          ) : (
            <ol className="mt-4 space-y-4">
              {data.activity.map((a) => {
                const st = actionStyle(a.action);
                const Icon = st.icon;
                return (
                  <li key={a.id} className="flex gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${st.tone}`}>
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{humanAction(a.action)}</p>
                      <p className="truncate text-xs text-gray-500">
                        {a.entityName ?? a.entityType.replace(/_/g, " ").toLowerCase()} · {a.admin?.name ?? "Platform"}
                      </p>
                    </div>
                    <time dateTime={new Date(a.createdAt).toISOString()} className="shrink-0 whitespace-nowrap text-xs text-gray-500">
                      {relTime(a.createdAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* Risk / health / campaigns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="risk-h">
          <CardHeader title="Risk Alerts" sub={`${unresolvedAlerts} unresolved · ${data.openRiskReviews} open risk reviews`} href={can("/admin/risk-compliance") ? "/admin/risk-compliance" : null} />
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ["High", data.fraud.high, "bg-red-50 text-red-700"],
              ["Medium", data.fraud.medium, "bg-amber-50 text-amber-700"],
              ["Low", data.fraud.low, "bg-gray-100 text-gray-700"],
            ].map(([k, v, tone]) => (
              <div key={k as string} className={`rounded-xl px-3 py-2 text-center ${tone}`}>
                <p className="text-lg font-semibold tabular-nums">{v as number}</p>
                <p className="text-[11px] font-medium">{k as string}</p>
              </div>
            ))}
          </div>
          {data.recentAlerts.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> No unresolved alerts.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-100">
              {data.recentAlerts.map((al) => (
                <li key={al.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${SEVERITY_PILL[al.severity] ?? SEVERITY_PILL.LOW}`}>{al.severity}</span>
                    <span className="text-xs text-gray-500">{relTime(al.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm text-gray-800">{al.description}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {humanAction(al.type)} · {al.entityType.toLowerCase()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="health-h">
          <CardHeader title="Platform Health" href={can("/admin/pilot-health") ? "/admin/pilot-health" : null} linkLabel="Details" />
          <div className={`mt-4 flex items-center gap-3 rounded-xl px-4 py-3 ${worst === "green" ? "bg-emerald-50" : worst === "amber" ? "bg-amber-50" : "bg-red-50"}`}>
            <span className={`relative grid h-3 w-3 place-items-center`}>
              <span className={`h-3 w-3 rounded-full ${LEVEL_DOT[worst]}`} aria-hidden />
            </span>
            <p className={`text-sm font-semibold ${LEVEL_TEXT[worst]}`}>
              {worst === "green" ? "All systems operational" : `${attention} check${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} attention`}
            </p>
          </div>
          <ul className="mt-4 space-y-3">
            {checks.map((c) => {
              const Icon = c.icon;
              const row = (
                <>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gray-50 text-gray-600">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                    <span className="block truncate text-xs text-gray-500" title={c.text}>
                      {c.text}
                    </span>
                  </span>
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${LEVEL_TEXT[c.level]}`}>
                    <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[c.level]}`} aria-hidden />
                    {c.level === "green" ? "OK" : c.level === "amber" ? "Check" : "Down"}
                  </span>
                </>
              );
              return (
                <li key={c.label}>
                  {c.href && can(c.href) ? (
                    <a href={c.href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-gray-50">
                      {row}
                    </a>
                  ) : (
                    <div className="flex items-center gap-3 py-1">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className={`${CARD} p-5 sm:p-6 lg:col-span-2 xl:col-span-1`} aria-labelledby="top-h">
          <CardHeader title="Top Performing Campaigns" sub="By amount raised" href={can("/admin/projects") ? "/admin/projects" : null} />
          {data.topCampaigns.length === 0 ? (
            <div className="mt-6">
              <EmptyState icon={Megaphone} title="No campaign has raised money yet" body="Active and completed campaigns appear here ranked by amount raised." />
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {data.topCampaigns.map((p) => {
                const pct = p.target > 0 ? Math.min(100, Math.round((p.raised / p.target) * 100)) : null;
                return (
                  <li key={p.id}>
                    <a href={`/projects/${p.id}`} className="group flex items-center gap-3">
                      <CoverThumb src={p.coverImage} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900 group-hover:text-trust-700">{p.title}</span>
                        <span className="block truncate text-xs text-gray-500">{p.ngo.orgName}</span>
                        {pct !== null && (
                          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden>
                            <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums text-gray-900">{formatCompactINR(Math.round(p.raised))}</span>
                        {pct !== null && <span className="block text-xs text-emerald-700">{pct}% of goal</span>}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-gray-200 px-6 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-gray-50 text-gray-500">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium text-gray-900">{title}</p>
      <p className="mt-1 max-w-xs text-xs text-gray-500">{body}</p>
    </div>
  );
}
