import { unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { TrendingUp, ShieldAlert, CalendarClock, Send, Info } from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKS = 8;

/**
 * Cache tag for the trend series below. Deliberately NOT exported — a
 * `page.tsx` may only export Next's reserved names. Same reasoning as
 * DASHBOARD_METRICS_TAG in app/admin/dashboard/page.tsx; lift it into `lib/`
 * if a mutation ever needs to invalidate it via `revalidateTag`.
 */
const TRUST_TRENDS_TAG = "admin-trust-trends";

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

/**
 * Week boundaries as plain millisecond numbers, derived deterministically from
 * a start timestamp — NOT from `new Date()`. Determinism matters because this
 * runs inside the cached function below: recomputing "this week" in there
 * would let a cached entry describe different weeks than the labels rendered
 * beside it.
 */
function bucketBoundsFrom(startMs: number, weeks: number): { start: number; end: number }[] {
  const bounds: { start: number; end: number }[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = new Date(startMs);
    start.setDate(start.getDate() + i * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    bounds.push({ start: start.getTime(), end: end.getTime() });
  }
  return bounds;
}

/**
 * The trend series, cached for five minutes.
 *
 * This page is a safe thing to cache, and most of the admin console is not.
 * The rule (from app/admin/dashboard/page.tsx) is: cache anything an admin
 * cannot make stale by an action taken on this page. Nothing here is an action
 * queue — it is eight weeks of history, and no button on this page changes it.
 * The verification, proof-review and risk queues stay deliberately uncached for
 * exactly the opposite reason.
 *
 * What earns the cache is the query shape, not the wall-clock saving: all five
 * of these fetch whole row sets in order to count them in JavaScript, and they
 * are unbounded — every fraud alert, every impact delivery, every verified
 * NGO's health score. They are cheap now and get linearly worse forever. This
 * caps them at once per five minutes regardless of traffic.
 *
 * ONLY PLAIN NUMBERS CROSS THE CACHE BOUNDARY. That is deliberate: the raw
 * rows carry `Date`s, and `healthScore` is a Prisma `Decimal` — a class
 * instance that does not survive serialization (cache one and it comes back as
 * `{s,e,d}`, on which `Number()` silently yields NaN). Doing the bucketing
 * inside means the expensive JS work is cached too, and the payload is a
 * handful of integer arrays instead of thousands of rows.
 *
 * `rangeStartMs` is an argument rather than a closure read so it forms part of
 * the cache key: when the week rolls over, the key changes and the entry is
 * refetched, instead of serving series misaligned against fresh labels.
 */
const getTrustTrendSeries = unstable_cache(
  async (rangeStartMs: number, weeks: number) => {
    const rangeStart = new Date(rangeStartMs);
    const bounds = bucketBoundsFrom(rangeStartMs, weeks);

    const [alertsRaised, alertsResolved, milestonesWithDeadlineInRange, deliveries, verifiedNgos] =
      await Promise.all([
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

    const bucketIndex = (date: Date) => {
      const t = date.getTime();
      return bounds.findIndex((b) => t >= b.start && t < b.end);
    };

    const raisedSeries = new Array(weeks).fill(0);
    for (const a of alertsRaised) {
      const idx = bucketIndex(a.createdAt);
      if (idx >= 0) raisedSeries[idx]++;
    }
    const resolvedSeries = new Array(weeks).fill(0);
    for (const a of alertsResolved) {
      if (!a.resolvedAt) continue;
      const idx = bucketIndex(a.resolvedAt);
      if (idx >= 0) resolvedSeries[idx]++;
    }

    // `nowTime` is evaluated when the cache entry is BUILT, not when it is
    // read, so "overdue" can lag by up to the revalidate window. Immaterial
    // here: this is an eight-week trend chart, and a milestone crossing its
    // deadline within a five-minute window does not change its shape. The
    // live overdue count an admin acts on comes from the Today inbox and
    // Impact Health, both of which stay uncached.
    const overdueSeries = new Array(weeks).fill(0);
    const nowTime = Date.now();
    for (const m of milestonesWithDeadlineInRange) {
      if (m.deadline.getTime() >= nowTime) continue; // only count weeks where the deadline has actually passed
      const idx = bucketIndex(m.deadline);
      if (idx >= 0) overdueSeries[idx]++;
    }

    const deliveryRateSeries = new Array(weeks).fill(100);
    const readRateSeries = new Array(weeks).fill(0);
    for (let i = 0; i < weeks; i++) {
      const weekDeliveries = deliveries.filter((d) => bucketIndex(d.createdAt) === i);
      const total = weekDeliveries.length;
      const delivered = weekDeliveries.filter((d) => d.status === "SENT" || d.status === "READ").length;
      const read = weekDeliveries.filter((d) => d.status === "READ").length;
      deliveryRateSeries[i] = total > 0 ? Math.round((delivered / total) * 100) : 100;
      readRateSeries[i] = delivered > 0 ? Math.round((read / delivered) * 100) : 0;
    }

    // Counts only — `Number()` is applied to each Decimal HERE, on the
    // database side of the cache boundary, so no Decimal instance is ever
    // serialized. Labels and colours stay in the component; they are
    // presentation, not data worth caching.
    const healthCounts = {
      strong: verifiedNgos.filter((n) => n.healthScore != null && Number(n.healthScore) >= 70).length,
      developing: verifiedNgos.filter(
        (n) => n.healthScore != null && Number(n.healthScore) >= 40 && Number(n.healthScore) < 70
      ).length,
      needsSupport: verifiedNgos.filter((n) => n.healthScore != null && Number(n.healthScore) < 40).length,
      tooNew: verifiedNgos.filter((n) => n.healthScore == null).length,
    };

    return {
      raisedSeries,
      resolvedSeries,
      overdueSeries,
      deliveryRateSeries,
      readRateSeries,
      healthCounts,
    };
  },
  ["admin-trust-trends"],
  { revalidate: 300, tags: [TRUST_TRENDS_TAG] }
);

export default async function TrustTrendsPage() {
  // Cheap, pure date maths — stays outside the cache so the rendered labels
  // are always "now", and so the week boundary forms the cache key below.
  const buckets = weekBuckets(WEEKS);

  const {
    raisedSeries,
    resolvedSeries,
    overdueSeries,
    deliveryRateSeries,
    readRateSeries,
    healthCounts,
  } = await getTrustTrendSeries(buckets[0].start.getTime(), WEEKS);

  const healthBuckets = [
    { label: "Strong (70-100)", count: healthCounts.strong, color: "bg-emerald-500" },
    { label: "Developing (40-69)", count: healthCounts.developing, color: "bg-amber-500" },
    { label: "Needs support (0-39)", count: healthCounts.needsSupport, color: "bg-red-500" },
    { label: "Too new to assess", count: healthCounts.tooNew, color: "bg-gray-400" },
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
