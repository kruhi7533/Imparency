import prisma from "@/lib/prisma";
import { TrendingUp, ShieldAlert, CalendarClock, Send, Info } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKS = 8;

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return date;
}

function weekBuckets(count: number): { start: Date; end: Date; label: string }[] {
  const buckets: { start: Date; end: Date; label: string }[] = [];
  const thisWeekStart = startOfWeek(new Date());
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(thisWeekStart);
    start.setDate(start.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    buckets.push({
      start,
      end,
      label: start.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    });
  }
  return buckets;
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex items-center justify-center shrink-0">
          <Icon size={18} strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="text-sm font-extrabold text-gray-900 dark:text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-400 leading-relaxed max-w-2xl">{subtitle}</p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Twin vertical bars per week — no charting library, dependency-free. */
function WeeklyTwinBars({
  buckets,
  seriesA,
  seriesB,
  colorA,
  colorB,
  legendA,
  legendB,
}: {
  buckets: { label: string }[];
  seriesA: number[];
  seriesB: number[];
  colorA: string;
  colorB: string;
  legendA: string;
  legendB: string;
}) {
  const max = Math.max(1, ...seriesA, ...seriesB);
  return (
    <div>
      <div className="flex items-center gap-4 mb-4 text-xs font-semibold">
        <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${colorA}`} />{legendA}</span>
        <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${colorB}`} />{legendB}</span>
      </div>
      <div className="flex items-end justify-between gap-2 h-32">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end justify-center gap-1 h-24">
              <div
                className={`w-2.5 rounded-t ${colorA}`}
                style={{ height: `${(seriesA[i] / max) * 100}%`, minHeight: seriesA[i] > 0 ? "2px" : "0" }}
                title={`${legendA}: ${seriesA[i]}`}
              />
              <div
                className={`w-2.5 rounded-t ${colorB}`}
                style={{ height: `${(seriesB[i] / max) * 100}%`, minHeight: seriesB[i] > 0 ? "2px" : "0" }}
                title={`${legendB}: ${seriesB[i]}`}
              />
            </div>
            <span className="text-[9px] text-gray-400 whitespace-nowrap">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Single-series vertical bars, for percentage trends (0-100). */
function WeeklyPercentBars({ buckets, series, color }: { buckets: { label: string }[]; series: number[]; color: string }) {
  return (
    <div className="flex items-end justify-between gap-2 h-32">
      {buckets.map((b, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <span className="text-[9px] font-bold text-gray-500">{series[i]}%</span>
          <div className="w-full flex items-end justify-center h-24">
            <div
              className={`w-4 rounded-t ${color}`}
              style={{ height: `${Math.max(series[i], series[i] > 0 ? 2 : 0)}%` }}
            />
          </div>
          <span className="text-[9px] text-gray-400 whitespace-nowrap">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

function Distribution({ buckets }: { buckets: { label: string; count: number; color: string }[] }) {
  const total = buckets.reduce((s, b) => s + b.count, 0) || 1;
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <div key={b.label} className="flex items-center gap-3">
          <span className="w-32 text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0">{b.label}</span>
          <div className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full rounded-full ${b.color}`} style={{ width: `${(b.count / total) * 100}%` }} />
          </div>
          <span className="w-8 text-xs font-bold text-gray-900 dark:text-white text-right shrink-0">{b.count}</span>
        </div>
      ))}
    </div>
  );
}

export default async function TrustTrendsPage() {
  const buckets = weekBuckets(WEEKS);
  const rangeStart = buckets[0].start;

  const [alertsRaised, alertsResolved, milestonesWithDeadlineInRange, deliveries, verifiedNgos] = await Promise.all([
    prisma.fraudAlert.findMany({
      where: { createdAt: { gte: rangeStart } },
      select: { createdAt: true },
    }),
    prisma.fraudAlert.findMany({
      where: { resolved: true, resolvedAt: { gte: rangeStart } },
      select: { resolvedAt: true },
    }),
    prisma.milestone.findMany({
      where: { deadline: { gte: rangeStart }, status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { deadline: true },
    }),
    prisma.impactDelivery.findMany({
      where: { createdAt: { gte: rangeStart } },
      select: { createdAt: true, status: true },
    }),
    prisma.nGOProfile.findMany({
      where: { verificationStatus: "VERIFIED", isDeleted: false },
      select: { healthScore: true },
    }),
  ]);

  const bucketIndex = (date: Date) => buckets.findIndex((b) => date >= b.start && date < b.end);

  const raisedSeries = new Array(WEEKS).fill(0);
  for (const a of alertsRaised) {
    const idx = bucketIndex(a.createdAt);
    if (idx >= 0) raisedSeries[idx]++;
  }
  const resolvedSeries = new Array(WEEKS).fill(0);
  for (const a of alertsResolved) {
    if (!a.resolvedAt) continue;
    const idx = bucketIndex(a.resolvedAt);
    if (idx >= 0) resolvedSeries[idx]++;
  }

  const overdueSeries = new Array(WEEKS).fill(0);
  const nowTime = Date.now();
  for (const m of milestonesWithDeadlineInRange) {
    if (m.deadline.getTime() >= nowTime) continue; // only count weeks where the deadline has actually passed
    const idx = bucketIndex(m.deadline);
    if (idx >= 0) overdueSeries[idx]++;
  }

  const deliveryRateSeries = new Array(WEEKS).fill(100);
  const readRateSeries = new Array(WEEKS).fill(0);
  for (let i = 0; i < WEEKS; i++) {
    const weekDeliveries = deliveries.filter((d) => bucketIndex(d.createdAt) === i);
    const total = weekDeliveries.length;
    const delivered = weekDeliveries.filter((d) => d.status === "SENT" || d.status === "READ").length;
    const read = weekDeliveries.filter((d) => d.status === "READ").length;
    deliveryRateSeries[i] = total > 0 ? Math.round((delivered / total) * 100) : 100;
    readRateSeries[i] = delivered > 0 ? Math.round((read / delivered) * 100) : 0;
  }

  const healthBuckets = [
    { label: "Strong (70-100)", count: verifiedNgos.filter((n) => n.healthScore != null && Number(n.healthScore) >= 70).length, color: "bg-emerald-500" },
    { label: "Developing (40-69)", count: verifiedNgos.filter((n) => n.healthScore != null && Number(n.healthScore) >= 40 && Number(n.healthScore) < 70).length, color: "bg-amber-500" },
    { label: "Needs support (0-39)", count: verifiedNgos.filter((n) => n.healthScore != null && Number(n.healthScore) < 40).length, color: "bg-red-500" },
    { label: "Too new to assess", count: verifiedNgos.filter((n) => n.healthScore == null).length, color: "bg-gray-400" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <TrendingUp size={24} strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Platform Trust Trends</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
              Is the platform getting more or less trustworthy over time? The last {WEEKS} weeks, from data
              recorded as it happened.
            </p>
          </div>
        </div>

        <SectionCard
          icon={ShieldAlert}
          title="Fraud Alerts — Raised vs Resolved"
          subtitle="Are new risk signals keeping up with how fast the team clears them? Resolved bars catching up to (or passing) raised bars is a good sign."
        >
          <WeeklyTwinBars
            buckets={buckets}
            seriesA={raisedSeries}
            seriesB={resolvedSeries}
            colorA="bg-red-400"
            colorB="bg-emerald-400"
            legendA="Raised"
            legendB="Resolved"
          />
        </SectionCard>

        <SectionCard
          icon={CalendarClock}
          title="Milestones That Became Overdue"
          subtitle="How many NGO-committed deadlines passed with no proof submitted, by the week the deadline fell in. A rising trend means more NGOs are falling behind on their own promises to donors."
        >
          <WeeklyPercentBars buckets={buckets} series={overdueSeries} color="bg-amber-500" />
        </SectionCard>

        <SectionCard
          icon={Send}
          title="Donor Impact Delivery & Read Rates"
          subtitle="Of the impact updates sent each week, what percentage actually reached donors, and what percentage donors opened. Both should stay high and steady."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2">Delivered</p>
              <WeeklyPercentBars buckets={buckets} series={deliveryRateSeries} color="bg-emerald-500" />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 mb-2">Opened by donors</p>
              <WeeklyPercentBars buckets={buckets} series={readRateSeries} color="bg-blue-500" />
            </div>
          </div>
        </SectionCard>

        <SectionCard
          icon={TrendingUp}
          title="NGO Health Score — Today's Snapshot"
          subtitle="Verified NGOs grouped by their current health score (fund utilization, milestone completion, proof speed, donor return)."
        >
          <Distribution buckets={healthBuckets} />
          <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
            <Info size={14} className="shrink-0 mt-0.5" />
            <p>
              This is a point-in-time snapshot, not a trend — health scores are recalculated fresh on every
              relevant event and don&apos;t keep history, so a weekly trend line isn&apos;t available yet.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
