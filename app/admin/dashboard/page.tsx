import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";

export const runtime = "nodejs";

function DashboardError({ detail }: { detail?: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/40 rounded-2xl shadow-sm p-8">
        <h1 className="text-xl font-extrabold text-gray-900 dark:text-white">Dashboard failed to load</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          A database query failed. This usually means the branch&apos;s Neon DB is behind the Prisma schema.
          Run the sync command and reload:
        </p>
        <pre className="mt-3 rounded-lg bg-gray-900 text-emerald-300 text-sm px-4 py-3 font-mono">npm run db:sync</pre>
        {detail && (
          <p className="mt-4 text-xs text-gray-400 font-mono break-all border-t border-gray-100 dark:border-gray-800 pt-3">
            {detail}
          </p>
        )}
        <a
          href="/admin/dashboard"
          className="mt-5 inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl transition"
        >
          Retry
        </a>
      </div>
    </div>
  );
}

async function loadDashboardData() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfFY = now.getMonth() >= 3
    ? new Date(currentYear, 3, 1)
    : new Date(currentYear - 1, 3, 1);

  const [
    pendingNGOs,
    donationsToday,
    donationsWeek,
    donationsMonth,
    donationsFY,
    activeNGOsCount,
    pendingNGOsCount,
    rejectedNGOsCount,
    avgHealthResult,
    totalDonorsCount,
    corporateDonorsCount,
    totalMilestonesCount,
    completedMilestonesCount,
    highFraudAlerts,
    mediumFraudAlerts,
    lowFraudAlerts,
    ngosWithProjects,
    projectsWithDonationsCount,
  ] = await Promise.all([
    prisma.nGOProfile.findMany({
      where: { verificationStatus: "PENDING" },
      select: {
        id: true,
        orgName: true,
        registrationNumber: true,
        panNumber: true,
        address: true,
        causeCategories: true,
        website: true,
        foundedYear: true,
        documents: true,
        createdAt: true,
        ai_verification_report: true,
        user: { select: { email: true } },
        screening: {
          select: {
            summary: true,
            extractedFields: true,
            documentChecklist: true,
            consistencyOk: true,
            flags: true,
            recommendation: true,
            confidence: true,
            status: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfToday } }, _sum: { amount: true } }),
    prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfWeek } }, _sum: { amount: true } }),
    prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfMonth } }, _sum: { amount: true } }),
    prisma.donation.aggregate({ where: { status: "SUCCESS", createdAt: { gte: startOfFY } }, _sum: { amount: true } }),
    prisma.nGOProfile.count({ where: { verificationStatus: "VERIFIED" } }),
    prisma.nGOProfile.count({ where: { verificationStatus: "PENDING" } }),
    prisma.nGOProfile.count({ where: { verificationStatus: "REJECTED" } }),
    prisma.nGOProfile.aggregate({ where: { NOT: { healthScore: null } }, _avg: { healthScore: true } }),
    prisma.user.count({ where: { role: "DONOR" } }),
    prisma.user.count({ where: { role: "DONOR", isCorporate: true } }),
    prisma.milestone.count(),
    prisma.milestone.count({ where: { status: { in: ["COMPLETED", "VERIFIED"] } } }),
    prisma.fraudAlert.count({ where: { resolved: false, severity: "HIGH" } }),
    prisma.fraudAlert.count({ where: { resolved: false, severity: "MEDIUM" } }),
    prisma.fraudAlert.count({ where: { resolved: false, severity: "LOW" } }),
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

  const milestoneCompletionRate = totalMilestonesCount > 0
    ? (completedMilestonesCount / totalMilestonesCount) * 100
    : 0;
  const unresolvedAlertsTotal = highFraudAlerts + mediumFraudAlerts + lowFraudAlerts;

  const ngoRaisedList = ngosWithProjects.map((ngo) => {
    const raised = ngo.projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);
    return { id: ngo.id, orgName: ngo.orgName, raised };
  });
  ngoRaisedList.sort((a, b) => b.raised - a.raised);
  const topNGOs = ngoRaisedList.slice(0, 5);

  projectsWithDonationsCount.sort((a, b) => b._count.donations - a._count.donations);
  const topProjects = projectsWithDonationsCount.slice(0, 5).map(p => ({
    id: p.id,
    title: p.title,
    ngoName: p.ngo.orgName,
    donorCount: p._count.donations,
  }));

  return {
    pendingNGOs,
    sumToday: Number(donationsToday._sum.amount || 0),
    sumWeek: Number(donationsWeek._sum.amount || 0),
    sumMonth: Number(donationsMonth._sum.amount || 0),
    sumFY: Number(donationsFY._sum.amount || 0),
    activeNGOsCount,
    pendingNGOsCount,
    rejectedNGOsCount,
    avgHealth: Number(avgHealthResult?._avg?.healthScore || 0),
    totalDonorsCount,
    corporateDonorsCount,
    milestoneCompletionRate,
    completedMilestonesCount,
    totalMilestonesCount,
    unresolvedAlertsTotal,
    topNGOs,
    topProjects,
  };
}

export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  let data: Awaited<ReturnType<typeof loadDashboardData>>;
  try {
    data = await loadDashboardData();
  } catch (err: any) {
    return <DashboardError detail={err?.message ?? String(err)} />;
  }

  const {
    pendingNGOs,
    sumToday, sumWeek, sumMonth, sumFY,
    activeNGOsCount, pendingNGOsCount, rejectedNGOsCount,
    avgHealth,
    totalDonorsCount, corporateDonorsCount,
    milestoneCompletionRate, completedMilestonesCount, totalMilestonesCount,
    unresolvedAlertsTotal,
    topNGOs, topProjects,
  } = data;

  const pendingProjectCount = await prisma.project.count({
    where: { status: "PENDING_APPROVAL", isDeleted: false },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">

      {/* Navbar */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-emerald-600 tracking-tight">ImpactBridge</span>
          <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-full font-bold">Admin Console</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex gap-4 text-sm font-semibold">
            <a href="/admin/dashboard" className="text-emerald-600 hover:text-emerald-700 transition underline decoration-2 underline-offset-4">NGO Verification</a>
            <a href="/admin/project-review" className="text-gray-500 hover:text-emerald-600 transition flex items-center gap-1.5">
              <span>Project Review</span>
              {pendingProjectCount > 0 && (
                <span className="bg-red-100 dark:bg-red-950/45 text-red-600 dark:text-red-400 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                  {pendingProjectCount}
                </span>
              )}
            </a>
            <a href="/admin/proof-review" className="text-gray-500 hover:text-emerald-600 transition">Proof Review</a>
            <a href="/admin/risk-compliance" className="text-gray-500 hover:text-emerald-600 transition flex items-center gap-1.5">
              <span>Risk &amp; Compliance</span>
              {unresolvedAlertsTotal > 0 && (
                <span className="bg-red-100 dark:bg-red-950/45 text-red-600 dark:text-red-400 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                  {unresolvedAlertsTotal}
                </span>
              )}
            </a>
            <a href="/admin/fcra-review" className="text-gray-500 hover:text-emerald-600 transition">FCRA Review</a>
          </div>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700"></div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
            <form method="POST" action="/api/auth/signout">
              <button type="submit" className="text-xs font-semibold text-gray-500 hover:text-red-500 transition">
                Logout
              </button>
            </form>
          </div>
        </div>
      </nav>

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
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white uppercase tracking-wider">Pending Registrations</h2>
          <AdminClient initialPendingNGOs={pendingNGOs} />
        </section>
      </main>
    </div>
  );
}
