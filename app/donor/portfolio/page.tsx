import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Navbar from "@/app/components/Navbar";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DonorPortfolioPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/portfolio");
  }

  const userId = session.user.id;

  const donor = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      donations: {
        where: { status: "SUCCESS" },
        include: {
          project: {
            select: {
              id: true,
              title: true,
              coverImage: true,
              causeCategory: true,
              raisedAmount: true,
              targetAmount: true,
              status: true,
              ngo: { select: { orgName: true } },
            },
          },
          taxReceipt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      followers: {
        include: {
          ngo: {
            select: {
              id: true,
              orgName: true,
              causeCategories: true,
              healthScore: true,
              description: true,
            },
          },
        },
      },
    },
  });

  if (!donor) {
    redirect("/login");
  }

  const totalAmount = Number(donor.totalDonated);
  const uniqueProjectIds = new Set(donor.donations.map((d) => d.projectId));
  const projectsCount = uniqueProjectIds.size;
  const followedCount = donor.followers.length;

  const activeFundedProjects = Array.from(
    new Map(
      donor.donations
        .filter((d) => d.project.status === "ACTIVE")
        .map((d) => [d.projectId, d.project])
    ).values()
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <Navbar />

      {/* Hero Header */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10"></div>
        
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
              My Impact Portfolio
            </h1>
            <p className="text-sm text-gray-400">
              Welcome back, <span className="text-gray-900 dark:text-white font-bold">{donor.name}</span>. Trace your transparency footprint.
            </p>
          </div>
          
          <div className="flex gap-4">
            <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl text-center shadow-inner animate-pulse">
              <span className="block text-xl font-black text-emerald-600 dark:text-emerald-400">
                ₹{totalAmount.toLocaleString()}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Total Contributed</span>
            </div>
            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-750 rounded-2xl text-center">
              <span className="block text-xl font-black text-gray-900 dark:text-white">
                {projectsCount}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Projects Funded</span>
            </div>
            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-750 rounded-2xl text-center">
              <span className="block text-xl font-black text-gray-900 dark:text-white">
                {followedCount}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">NGOs Followed</span>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Portfolio Ledger Feed */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Donations Ledger</h2>
                <p className="text-xs text-gray-400">Chronological history of your verified contributions and tax receipts.</p>
              </div>

              {donor.donations.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-200 dark:border-gray-800 rounded-2xl">
                  <span className="text-4xl mb-3 block">🌱</span>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">Start your impact footprint</h4>
                  <p className="text-xs text-gray-400 mt-1 mb-4">You have not made any donations on ImpactBridge yet.</p>
                  <Link href="/discover" className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl text-xs shadow-md transition">
                    Browse Campaigns
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {donor.donations.map((donation) => (
                    <div key={donation.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 rounded-2xl transition gap-4">
                      <div className="space-y-1">
                        <Link href={`/projects/${donation.project.id}`} className="text-sm font-extrabold text-gray-900 dark:text-white hover:text-emerald-600 transition block">
                          {donation.project.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
                          <span>By {donation.project.ngo.orgName}</span>
                          <span>•</span>
                          <span>{new Date(donation.createdAt).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-right">
                          <span className="text-sm font-black text-gray-900 dark:text-white">
                            ₹{Number(donation.amount).toLocaleString()}
                          </span>
                          <span className="block text-[8px] text-emerald-600 dark:text-emerald-400 font-extrabold uppercase">Verified</span>
                        </div>
                        
                        {donation.taxReceipt && (
                          <a
                            href={donation.taxReceipt.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 font-bold px-3 py-2 rounded-xl text-[10px] flex items-center gap-1 transition shadow-sm"
                          >
                            <span>📄</span> Receipt
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-8">
            
            {/* Active Supported Campaigns */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Active Campaigns</h3>
              {activeFundedProjects.length === 0 ? (
                <p className="text-xs text-gray-400">No active campaigns currently funded.</p>
              ) : (
                <div className="space-y-4">
                  {activeFundedProjects.map((project) => {
                    const raised = Number(project.raisedAmount);
                    const target = Number(project.targetAmount);
                    const percent = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
                    return (
                      <div key={project.id} className="space-y-1.5 p-3 border border-gray-100 dark:border-gray-800 rounded-xl">
                        <Link href={`/projects/${project.id}`} className="text-xs font-extrabold text-gray-900 dark:text-white hover:text-emerald-600 transition block truncate">
                          {project.title}
                        </Link>
                        <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${percent}%` }}></div>
                        </div>
                        <div className="flex justify-between text-[8px] font-bold text-gray-400">
                          <span>{percent}% Funded</span>
                          <span>₹{raised.toLocaleString()} raised</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Followed NGOs */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Followed Non-Profits</h3>
              {donor.followers.length === 0 ? (
                <p className="text-xs text-gray-400">You are not following any NGOs yet.</p>
              ) : (
                <div className="space-y-4">
                  {donor.followers.map((follow) => (
                    <div key={follow.ngo.id} className="flex justify-between items-center gap-3">
                      <div className="space-y-0.5 truncate">
                        <Link href={`/ngo/${follow.ngo.id}`} className="text-xs font-extrabold text-gray-900 dark:text-white hover:text-emerald-600 transition block truncate">
                          {follow.ngo.orgName}
                        </Link>
                        <span className="text-[9px] text-gray-400">Health Score: {Number(follow.ngo.healthScore).toFixed(0)}</span>
                      </div>
                      <Link
                        href={`/ngo/${follow.ngo.id}`}
                        className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 transition font-bold px-2.5 py-1.5 rounded-lg text-[9px] border border-emerald-100 dark:border-emerald-900/50"
                      >
                        Visit Profile
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
