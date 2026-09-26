import { unstable_cache } from "next/cache";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Cache tag for the statistics block below. Deliberately NOT exported: a
 * `page.tsx` may only export Next's own reserved names (`default`, `metadata`,
 * `revalidate`, …) and anything else is a build error. If a mutation ever needs
 * to invalidate this block on demand via `revalidateTag`, lift this constant
 * into `lib/` and import it from both places.
 */
const DASHBOARD_METRICS_TAG = "admin-dashboard-metrics";

/**
 * The dashboard's read-only statistics, cached for a minute.
 *
 * Be clear about what this does and does not buy, because the obvious
 * assumption is wrong. Measured against the live database:
 *
 *     pendingNGOs findMany (below)      340ms   ← the critical path
 *     these 11 aggregates, in parallel  128ms
 *     the 6 cheap live counts            64ms
 *     all 18 together                   363ms
 *
 * The page's latency is almost entirely the `pendingNGOs` query; everything
 * else runs in parallel underneath it. Caching this block is worth ~22ms today
 * — it is NOT the fix for dashboard latency, and nobody should read it as one.
 *
 * It earns its place for a different reason: two of these queries
 * (`ngosWithProjects`, `projectsWithDonationsCount`) are unbounded scans that
 * fetch every NGO with every project's raised amount, and every project with
 * its donation count. They are cheap now and get linearly worse forever. This
 * caps them at once per minute regardless of traffic — the same "buy it while
 * it is free" reasoning as the hot-path indexes.
 *
 * The split is deliberate and the rule is: **cache anything an admin cannot
 * make stale by an action taken on this page.** Approving or rejecting an NGO
 * changes the verification queue and its three status counts, so those stay
 * live — a queue that still lists an NGO you just approved is a bug, not a
 * stale statistic. Fraud alert counts also stay live, because a badge reading
 * "0 HIGH" when there are three is exactly the kind of false reassurance this
 * codebase refuses to render elsewhere.
 *
 * Everything crossing the cache boundary is converted to a plain number or
 * plain object first. Prisma's `Decimal` is a class instance and does NOT
 * survive serialization — cache one and you get `{s,e,d}` back, and `Number()`
 * on it silently yields NaN.
 */
const getDashboardMetrics = unstable_cache(
  async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfFY =
      now.getMonth() >= 3 ? new Date(currentYear, 3, 1) : new Date(currentYear - 1, 3, 1);

    const [
      donationsToday,
      donationsWeek,
      donationsMonth,
      donationsFY,
      avgHealthResult,
      totalDonorsCount,
      corporateDonorsCount,
      totalMilestonesCount,
      completedMilestonesCount,
      ngosWithProjects,
      projectsWithDonationsCount,
    ] = await Promise.all([
      prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfToday } }, _sum: { amount: true } }),
      prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfWeek } }, _sum: { amount: true } }),
      prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfMonth } }, _sum: { amount: true } }),
      prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfFY } }, _sum: { amount: true } }),
      prisma.nGOProfile.aggregate({ where: { NOT: { healthScore: null } }, _avg: { healthScore: true } }),
      prisma.user.count({ where: { role: "DONOR" } }),
      prisma.user.count({ where: { role: "DONOR", isCorporate: true } }),
      prisma.milestone.count(),
      prisma.milestone.count({ where: { status: { in: ["COMPLETED", "VERIFIED"] } } }),
      // These two are unbounded scans — every NGO with every project's raised
      // amount, and every project with its donation count. They are the most
      // expensive queries on the page and the ones that degrade worst as the
      // platform grows, which makes them the most worth caching.
      prisma.nGOProfile.findMany({
        select: { id: true, orgName: true, projects: { select: { raisedAmount: true } } },
      }),
      prisma.project.findMany({
        select: {
          id: true,
          title: true,
          ngo: { select: { orgName: true } },
          _count: { select: { donations: { where: { status: "SUCCESS" } } } },
        },
      }),
    ]);

    const ngoRaisedList = ngosWithProjects.map((ngo) => ({
      id: ngo.id,
      orgName: ngo.orgName,
      raised: ngo.projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0),
    }));
    ngoRaisedList.sort((a, b) => b.raised - a.raised);

    projectsWithDonationsCount.sort((a, b) => b._count.donations - a._count.donations);

    return {
      sumToday: Number(donationsToday._sum.amount || 0),
      sumWeek: Number(donationsWeek._sum.amount || 0),
      sumMonth: Number(donationsMonth._sum.amount || 0),
      sumFY: Number(donationsFY._sum.amount || 0),
      avgHealth: Number(avgHealthResult?._avg?.healthScore || 0),
      totalDonorsCount,
      corporateDonorsCount,
      totalMilestonesCount,
      completedMilestonesCount,
      milestoneCompletionRate:
        totalMilestonesCount > 0 ? (completedMilestonesCount / totalMilestonesCount) * 100 : 0,
      topNGOs: ngoRaisedList.slice(0, 5),
      topProjects: projectsWithDonationsCount.slice(0, 5).map((p) => ({
        id: p.id,
        title: p.title,
        ngoName: p.ngo.orgName,
        donorCount: p._count.donations,
      })),
    };
  },
  [DASHBOARD_METRICS_TAG],
  { revalidate: 60, tags: [DASHBOARD_METRICS_TAG] }
);

async function loadDashboardData() {
  // Live queries only — everything here is either something the admin acts on
  // from this page (so it must reflect their last action immediately) or a
  // safety signal that must never be shown stale. The statistics come from the
  // cached block above. See getDashboardMetrics for the rule.
  const [
    metrics,
    activeNGOsCount,
    pendingNGOsCount,
    rejectedNGOsCount,
    highFraudAlerts,
    mediumFraudAlerts,
    lowFraudAlerts,
  ] = await Promise.all([
    getDashboardMetrics(),
    prisma.nGOProfile.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.nGOProfile.count({ where: { verificationStatus: "PENDING" } }),
    prisma.nGOProfile.count({ where: { verificationStatus: "REJECTED" } }),
    prisma.fraudAlert.count({ where: { resolved: false, severity: "HIGH" } }),
    prisma.fraudAlert.count({ where: { resolved: false, severity: "MEDIUM" } }),
    prisma.fraudAlert.count({ where: { resolved: false, severity: "LOW" } }),
  ]);

  return {
    activeNGOsCount,
    pendingNGOsCount,
    rejectedNGOsCount,
    unresolvedAlertsTotal: highFraudAlerts + mediumFraudAlerts + lowFraudAlerts,
    ...metrics,
  };
}

export default async function AdminDashboardPage() {
  let data: Awaited<ReturnType<typeof loadDashboardData>>;
  try {
    data = await loadDashboardData();
  } catch (err: any) {
    return <SchemaOutOfSync title="Dashboard failed to load" detail={err?.message ?? String(err)} />;
  }

  const {
    sumToday, sumWeek, sumMonth, sumFY,
    activeNGOsCount, pendingNGOsCount, rejectedNGOsCount,
    avgHealth,
    totalDonorsCount, corporateDonorsCount,
    milestoneCompletionRate, completedMilestonesCount, totalMilestonesCount,
    topNGOs, topProjects,
  } = data;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Verification Panel</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Review and approve pending NGO registrations and document submissions.
          </p>
        </div>

        {/* 1. Analytics Cards Section */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Donations Today</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">₹{sumToday.toLocaleString("en-IN")}</h3>
            <div className="text-[10px] text-gray-400 mt-0.5">Successful transactions</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Donations This Week</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">₹{sumWeek.toLocaleString("en-IN")}</h3>
            <div className="text-[10px] text-gray-400 mt-0.5">Successful transactions</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Donations This Month</span>
            <h3 className="text-2xl font-black text-gray-900 dark:text-white mt-1">₹{sumMonth.toLocaleString("en-IN")}</h3>
            <div className="text-[10px] text-gray-400 mt-0.5">Successful transactions</div>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Financial Year Spend</span>
            <h3 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">₹{sumFY.toLocaleString("en-IN")}</h3>
            <div className="text-[10px] text-gray-400 mt-0.5">Indian FY total contributions</div>
          </div>
        </section>

        {/* 2. Platform Counts section */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">NGO Registration Status</span>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-650 dark:text-gray-300">
                <span>Verified (Active):</span>
                <span className="font-bold">{activeNGOsCount}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-650 dark:text-gray-300">
                <span>Pending Review:</span>
                <span className="font-bold text-yellow-600">{pendingNGOsCount}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-650 dark:text-gray-300">
                <span>Rejected / Audited:</span>
                <span className="font-bold text-red-500">{rejectedNGOsCount}</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Platform Health Index</span>
              <h3 className="text-3xl font-black text-emerald-600 mt-1">{avgHealth > 0 ? avgHealth.toFixed(1) : "N/A"}/100</h3>
            </div>
            <div className="text-[10px] text-gray-400">Average NGO credibility score</div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Donor Demographics</span>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs text-gray-650 dark:text-gray-300">
                <span>Total Donors:</span>
                <span className="font-bold">{totalDonorsCount}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-650 dark:text-gray-300">
                <span>Corporate Accounts:</span>
                <span className="font-bold text-emerald-600">{corporateDonorsCount}</span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Milestone Progress</span>
              <h3 className="text-3xl font-black text-gray-900 dark:text-white mt-1">{milestoneCompletionRate.toFixed(0)}%</h3>
            </div>
            <div className="text-[10px] text-gray-400">Completion rate ({completedMilestonesCount}/{totalMilestonesCount} milestones)</div>
          </div>
        </section>

        {/* 3. Top NGOs and Projects Lists */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Top NGOs */}
          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Top 5 NGOs (Funds Raised)</h3>
            {topNGOs.length === 0 ? (
              <p className="text-xs text-gray-450 italic">No funds raised yet.</p>
            ) : (
              <div className="space-y-3">
                {topNGOs.map((ngo, idx) => (
                  <div key={ngo.id} className="flex justify-between items-center text-xs p-2 border-b border-gray-105 dark:border-gray-800/40 last:border-b-0">
                    <div className="font-semibold text-gray-850 dark:text-gray-200 flex items-center gap-1.5">
                      {idx + 1}.{" "}
                      <a href={`/ngo/${ngo.id}`} className="hover:text-emerald-600 dark:hover:text-emerald-400 transition hover:underline underline-offset-2">
                        {ngo.orgName}
                      </a>
                    </div>
                    <div className="font-black text-emerald-655 dark:text-emerald-455">
                      ₹{ngo.raised.toLocaleString("en-IN")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Projects */}
          <div className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Top 5 Projects (Donor count)</h3>
            {topProjects.length === 0 ? (
              <p className="text-xs text-gray-450 italic">No projects launched yet.</p>
            ) : (
              <div className="space-y-3">
                {topProjects.map((project, idx) => (
                  <div key={project.id} className="flex justify-between items-center text-xs p-2 border-b border-gray-105 dark:border-gray-800/40 last:border-b-0">
                    <div>
                      <div className="font-semibold text-gray-850 dark:text-gray-200 truncate max-w-[200px]" title={project.title}>
                        {idx + 1}. {project.title}
                      </div>
                      <div className="text-[10px] text-gray-400">NGO: {project.ngoName}</div>
                    </div>
                    <div className="font-black text-gray-800 dark:text-gray-300">
                      {project.donorCount} donors
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 4. Main Verification List Client Component */}
        {/* The verification queue moved to /admin/verification. It was the last
            section of this page, under four rows of metrics and two
            leaderboards — a full screen of scrolling before an admin reached
            the work. It is the console's primary job and now has its own page. */}
      </main>
    </div>
  );
}
