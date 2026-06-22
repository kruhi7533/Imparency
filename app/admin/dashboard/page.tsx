import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import AdminClient from "./AdminClient";

export const runtime = "nodejs";

export default async function AdminDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if (session.user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  // 1. Fetch pending NGOs
  const pendingNGOs = await prisma.nGOProfile.findMany({
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
      user: {
        select: {
          email: true,
        },
      },
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
  });

  // 2. Compute Platform Analytics via Prisma
  const now = new Date();
  const currentYear = now.getFullYear();

  // Start times
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())); // Sunday
  // Reset date for month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfFY = now.getMonth() >= 3 
    ? new Date(currentYear, 3, 1) 
    : new Date(currentYear - 1, 3, 1);

  // Donations Queries
  const donationsToday = await prisma.donation.aggregate({
    where: { status: "SUCCESS", createdAt: { gte: startOfToday } },
    _sum: { amount: true }
  });
  const donationsWeek = await prisma.donation.aggregate({
    where: { status: "SUCCESS", createdAt: { gte: startOfWeek } },
    _sum: { amount: true }
  });
  const donationsMonth = await prisma.donation.aggregate({
    where: { status: "SUCCESS", createdAt: { gte: startOfMonth } },
    _sum: { amount: true }
  });
  const donationsFY = await prisma.donation.aggregate({
    where: { status: "SUCCESS", createdAt: { gte: startOfFY } },
    _sum: { amount: true }
  });

  // NGO Profile counts
  const activeNGOsCount = await prisma.nGOProfile.count({ where: { verificationStatus: "VERIFIED" } });
  const pendingNGOsCount = await prisma.nGOProfile.count({ where: { verificationStatus: "PENDING" } });
  const rejectedNGOsCount = await prisma.nGOProfile.count({ where: { verificationStatus: "REJECTED" } });

  // Average Health Score
  const avgHealthResult = await prisma.nGOProfile.aggregate({
    where: { NOT: { healthScore: null } },
    _avg: { healthScore: true }
  });

  // Donor counts
  const totalDonorsCount = await prisma.user.count({ where: { role: "DONOR" } });
  const corporateDonorsCount = await prisma.user.count({ where: { role: "DONOR", isCorporate: true } });

  // Milestone completion rate
  const totalMilestonesCount = await prisma.milestone.count();
  const completedMilestonesCount = await prisma.milestone.count({
    where: { status: { in: ["COMPLETED", "VERIFIED"] } }
  });
  const milestoneCompletionRate = totalMilestonesCount > 0 
    ? (completedMilestonesCount / totalMilestonesCount) * 100 
    : 0;

  // Unresolved Fraud alerts
  const highFraudAlerts = await prisma.fraudAlert.count({ where: { resolved: false, severity: "HIGH" } });
  const mediumFraudAlerts = await prisma.fraudAlert.count({ where: { resolved: false, severity: "MEDIUM" } });
  const lowFraudAlerts = await prisma.fraudAlert.count({ where: { resolved: false, severity: "LOW" } });
  const unresolvedAlertsTotal = highFraudAlerts + mediumFraudAlerts + lowFraudAlerts;

  // Top 5 NGOs by funds raised
  const ngosWithProjects = await prisma.nGOProfile.findMany({
    select: {
      id: true,
      orgName: true,
      projects: {
        select: { raisedAmount: true }
      }
    }
  });
  const ngoRaisedList = ngosWithProjects.map((ngo) => {
    const raised = ngo.projects.reduce((sum, p) => sum + Number(p.raisedAmount), 0);
    return { id: ngo.id, orgName: ngo.orgName, raised };
  });
  ngoRaisedList.sort((a, b) => b.raised - a.raised);
  const topNGOs = ngoRaisedList.slice(0, 5);

  // Top 5 projects by donor count
  const projectsWithDonationsCount = await prisma.project.findMany({
    select: {
      id: true,
      title: true,
      ngo: { select: { orgName: true } },
      _count: {
        select: { donations: { where: { status: "SUCCESS" } } }
      }
    }
  });
  projectsWithDonationsCount.sort((a, b) => b._count.donations - a._count.donations);
  const topProjects = projectsWithDonationsCount.slice(0, 5).map(p => ({
    id: p.id,
    title: p.title,
    ngoName: p.ngo.orgName,
    donorCount: p._count.donations
  }));

  // Parse decimals safely
  const sumToday = Number(donationsToday._sum.amount || 0);
  const sumWeek = Number(donationsWeek._sum.amount || 0);
  const sumMonth = Number(donationsMonth._sum.amount || 0);
  const sumFY = Number(donationsFY._sum.amount || 0);
  const avgHealth = Number(avgHealthResult?._avg?.healthScore || 0);

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
            <a href="/admin/proof-review" className="text-gray-500 hover:text-emerald-600 transition">Proof Review</a>
            <a href="/admin/fraud-alerts" className="text-gray-500 hover:text-emerald-600 transition flex items-center gap-1.5">
              <span>Fraud Alerts</span>
              {unresolvedAlertsTotal > 0 && (
                <span className="bg-red-100 dark:bg-red-950/45 text-red-600 dark:text-red-400 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                  {unresolvedAlertsTotal}
                </span>
              )}
            </a>
          </div>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700"></div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
            <a
              href="/api/auth/signout"
              className="text-xs font-semibold text-gray-500 hover:text-red-500 transition"
            >
              Logout
            </a>
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
                    <div className="font-semibold text-gray-850 dark:text-gray-200">
                      {idx + 1}. {ngo.orgName}
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
