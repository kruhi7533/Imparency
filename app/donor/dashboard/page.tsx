import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { Role } from "@prisma/client";
import DismissButton from "./components/DismissButton";
import ReadMoreNarrative from "./components/ReadMoreNarrative";

export const dynamic = "force-dynamic";

export default async function DonorDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== Role.DONOR) {
    redirect("/login?callbackUrl=/donor/dashboard");
  }

  const userId = session.user.id;

  // 1. Fetch donor details with follows
  const donor = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      followers: {
        include: {
          ngo: {
            select: {
              id: true,
              orgName: true,
              healthScore: true,
              causeCategories: true,
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

  // 2. Fetch latest active re-engagement event
  const latestEvent = await prisma.reEngagementEvent.findFirst({
    where: {
      donorId: userId,
      dismissed: false,
    },
    orderBy: { emailSentAt: "desc" },
  });

  // Calculate stats
  const totalAmount = Number(donor.totalDonated);
  const donationCount = await prisma.donation.count({
    where: { donorId: userId, status: "SUCCESS" },
  });
  const followedCount = donor.followers.length;

  // 3. Fetch top 5 donations
  const donations = await prisma.donation.findMany({
    where: { donorId: userId, status: "SUCCESS" },
    include: {
      project: {
        include: {
          ngo: {
            select: {
              id: true,
              orgName: true,
            },
          },
        },
      },
      taxReceipt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // 4. Fetch top 3 impact reports
  const impactReports = await prisma.impactReport.findMany({
    where: { donorId: userId },
    include: {
      donation: {
        include: {
          project: {
            include: {
              ngo: {
                select: {
                  orgName: true,
                },
              },
            },
          },
        },
      },
      milestone: true,
    },
    orderBy: { sentAt: "desc" },
    take: 3,
  });

  // 5. Gather additional context if there is an active event
  let lastNgoName = "";
  let referredNGO: any = null;

  if (latestEvent) {
    const triggeringReport = await prisma.impactReport.findUnique({
      where: { id: latestEvent.reportId },
      include: {
        donation: {
          include: {
            project: {
              include: {
                ngo: true,
              },
            },
          },
        },
      },
    });

    if (triggeringReport) {
      lastNgoName = triggeringReport.donation.project.ngo.orgName;

      if (latestEvent.path === "NGO_REFERRAL") {
        const allDonatedNgos = await prisma.donation.findMany({
          where: { donorId: userId, status: "SUCCESS" },
          select: { project: { select: { ngoId: true } } },
        });
        const donatedNgoIds = allDonatedNgos.map((d) => d.project.ngoId);

        referredNGO = await prisma.nGOProfile.findFirst({
          where: {
            verificationStatus: "VERIFIED",
            isDeleted: false,
            id: { notIn: donatedNgoIds },
            causeCategories: {
              hasSome: triggeringReport.donation.project.ngo.causeCategories,
            },
          },
          orderBy: { healthScore: "desc" },
          select: {
            id: true,
            orgName: true,
            causeCategories: true,
            healthScore: true,
            description: true,
          },
        });
      }
    }
  }

  // Helper for rendering badges
  const renderTierBadge = (tier: string) => {
    switch (tier) {
      case "MAJOR_DONOR":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            👑 Major Donor
          </span>
        );
      case "COMMITTED":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            🌱 Committed Donor
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-500/10 text-slate-400 border border-slate-500/20">
            🛡️ Standard Donor
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-16">
      {/* Background radial effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl -z-10 pointer-events-none" />

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
        
        {/* Welcome Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
              Donor Dashboard
              {renderTierBadge(donor.donorTier)}
            </h1>
            <p className="text-sm text-gray-400">
              Welcome back, <span className="text-white font-bold">{donor.name}</span>. Review your verified contributions, tax compliance, and NGO reports.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/donor/portfolio"
              className="bg-gray-900 hover:bg-gray-850 text-gray-200 border border-gray-800 font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm"
            >
              My Portfolio
            </Link>
            <Link
              href="/donor/profile"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-md transition"
            >
              Profile Settings
            </Link>
          </div>
        </header>

        {/* Re-engagement CTA Card */}
        {latestEvent && (
          <section className="relative border border-amber-500/30 dark:border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-amber-600/5 to-transparent rounded-2xl p-6 mb-8 border-l-4 border-l-amber-500 shadow-lg shadow-amber-500/5 overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/5 rounded-full blur-2xl -z-10 pointer-events-none" />
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              
              {/* Copy based on path */}
              <div className="space-y-2 max-w-3xl">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300">
                  ✨ Suggested for you
                </span>

                {latestEvent.path === "TIER_UPGRADE" && (
                  <>
                    <h3 className="text-lg font-black text-white">Unlock Your Next Donor Tier Status</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      You have completed <strong className="text-amber-400 font-extrabold">{donationCount} successful donations</strong>! You are close to unlocking a higher donor status which will give you premium compliance reports, direct NGO message previews, and early project accesses.
                    </p>
                  </>
                )}

                {latestEvent.path === "NGO_REFERRAL" && referredNGO && (
                  <>
                    <h3 className="text-lg font-black text-white">Extend Your Impact with {referredNGO.orgName}</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      We noticed you recently funded <strong className="text-white font-bold">{lastNgoName}</strong>. If you are passionate about this cause, we recommend checking out <strong className="text-amber-400 font-extrabold">{referredNGO.orgName}</strong>, a verified non-profit doing excellent work in <strong className="text-white">{referredNGO.causeCategories.join(", ")}</strong> with a health rating of <strong className="text-emerald-400">{Number(referredNGO.healthScore || 0).toFixed(0)}/100</strong>.
                    </p>
                  </>
                )}

                {latestEvent.path === "NGO_REFERRAL" && !referredNGO && (
                  <>
                    <h3 className="text-lg font-black text-white">Explore Verified NGO Recommendations</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      Based on your support for <strong className="text-white font-bold">{lastNgoName}</strong>, look at our community recommendations list to identify active social projects matching your interest profile.
                    </p>
                  </>
                )}

                {latestEvent.path === "GRANT_MODE" && (
                  <>
                    <h3 className="text-lg font-black text-white">Configure Structured Grant Allocations</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      As an institutional/corporate partner with <strong className="text-amber-400 font-extrabold">₹{totalAmount.toLocaleString("en-IN")}</strong> in cumulative contributions, you can configure recurring milestone-based Grant accounts to systematically distribute matching pools.
                    </p>
                  </>
                )}

                {latestEvent.path === "VOLUNTEER_ADVISOR" && (
                  <>
                    <h3 className="text-lg font-black text-white">Join as a Volunteer Advisor at {lastNgoName}</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      Your expertise and volunteer interest can make a direct difference at <strong className="text-white font-bold">{lastNgoName}</strong>! Complete your profile preferences to match with volunteer advisory opportunities.
                    </p>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 shrink-0">
                {latestEvent.path === "TIER_UPGRADE" && (
                  <Link
                    href="/donor/portfolio"
                    className="bg-amber-500 hover:bg-amber-600 text-gray-950 font-bold px-4 py-2 rounded-xl text-xs shadow-md transition whitespace-nowrap"
                  >
                    View Tier Details
                  </Link>
                )}
                {latestEvent.path === "NGO_REFERRAL" && (
                  <Link
                    href={referredNGO ? `/ngo/${referredNGO.id}` : "/discover"}
                    className="bg-amber-50 hover:bg-amber-100 text-gray-950 font-bold px-4 py-2 rounded-xl text-xs shadow-md transition whitespace-nowrap"
                  >
                    View NGO Profile
                  </Link>
                )}
                {latestEvent.path === "GRANT_MODE" && (
                  <Link
                    href="/donor/portfolio?tab=csr"
                    className="bg-amber-500 hover:bg-amber-600 text-gray-950 font-bold px-4 py-2 rounded-xl text-xs shadow-md transition whitespace-nowrap"
                  >
                    Manage Grant Options
                  </Link>
                )}
                {latestEvent.path === "VOLUNTEER_ADVISOR" && (
                  <Link
                    href="/donor/profile"
                    className="bg-amber-500 hover:bg-amber-600 text-gray-950 font-bold px-4 py-2 rounded-xl text-xs shadow-md transition whitespace-nowrap"
                  >
                    Complete Advisor Profile
                  </Link>
                )}

                <DismissButton eventId={latestEvent.id} />
              </div>
            </div>
          </section>
        )}

        {/* Stats Row */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition shadow-sm space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Contributions</span>
            <span className="text-2xl font-black text-emerald-400 block">
              ₹{totalAmount.toLocaleString("en-IN")}
            </span>
            <span className="text-[10px] text-gray-500 block">Lifetime processed funds</span>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition shadow-sm space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Donations Processed</span>
            <span className="text-2xl font-black text-white block">{donationCount}</span>
            <span className="text-[10px] text-gray-500 block">Successful transactions</span>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition shadow-sm space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Followed NGOs</span>
            <span className="text-2xl font-black text-white block">{followedCount}</span>
            <span className="text-[10px] text-gray-500 block">Monitoring organizations</span>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition shadow-sm space-y-1">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Impact Score Status</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-black text-amber-400 block">100%</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">
                AUDITED
              </span>
            </div>
            <span className="text-[10px] text-gray-500 block">Milestones AI validated</span>
          </div>
        </section>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Recent Donations Ledger */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-bold text-white">Recent Contributions Ledger</h2>
                  <p className="text-xs text-gray-400">Your latest 5 successful donations and related tax certificates.</p>
                </div>
                <Link
                  href="/donor/portfolio"
                  className="text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  View All &rarr;
                </Link>
              </div>

              {donations.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-800 rounded-2xl">
                  <span className="text-4xl mb-3 block">🌱</span>
                  <h4 className="text-sm font-bold text-white">Start your impact footprint</h4>
                  <p className="text-xs text-gray-400 mt-1 mb-4">You have not made any contributions yet.</p>
                  <Link href="/discover" className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl text-xs shadow-md transition">
                    Browse Social Projects
                  </Link>
                </div>
              ) : (
                <div className="border border-gray-800 rounded-2xl overflow-hidden bg-gray-950/40">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-800">
                      <thead className="bg-gray-900/50">
                        <tr>
                          <th className="px-5 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Project / NGO</th>
                          <th className="px-5 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
                          <th className="px-5 py-3.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Amount</th>
                          <th className="px-5 py-3.5 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tax Receipt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {donations.map((donation) => (
                          <tr key={donation.id} className="hover:bg-gray-900/30 transition-colors">
                            <td className="px-5 py-4">
                              <div className="text-xs font-bold text-white max-w-[200px] truncate" title={donation.project.title}>
                                {donation.project.title}
                              </div>
                              <div className="text-[10px] text-gray-450 truncate max-w-[200px]">
                                {donation.project.ngo.orgName}
                              </div>
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-xs text-gray-400">
                              {new Date(donation.createdAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-xs font-black text-emerald-400">
                              ₹{Number(donation.amount).toLocaleString("en-IN")}
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-right text-xs">
                              {donation.taxReceipt ? (
                                <a
                                  href={donation.taxReceipt.pdfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 bg-gray-800 hover:bg-gray-750 text-gray-200 border border-gray-700 font-bold px-2.5 py-1.5 rounded-lg text-[10px] transition shadow-sm"
                                >
                                  📄 Download
                                </a>
                              ) : (
                                <span className="text-[10px] text-gray-500 italic">Processing</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Impact Reports Feed */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white">Impact Reports</h2>
                <p className="text-xs text-gray-400">Generative AI reports covering completed milestones and funds utilization.</p>
              </div>

              {impactReports.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-800 rounded-2xl bg-gray-950/20">
                  <span className="text-4xl mb-3 block">📝</span>
                  <h4 className="text-xs font-bold text-gray-400">Pending reports</h4>
                  <p className="text-[10px] text-gray-500 mt-1 max-w-sm mx-auto">
                    You will receive AI-generated impact summaries once the non-profits complete and verify their project milestones.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {impactReports.map((report) => (
                    <article
                      key={report.id}
                      className="border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition bg-gray-950/30 space-y-4"
                    >
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-800/80 pb-3">
                        <div className="space-y-0.5">
                          <h4 className="text-xs font-bold text-gray-400">
                            Report: {report.milestone.title}
                          </h4>
                          <span className="text-[10px] text-gray-500 block">
                            Project: <strong className="text-gray-300 font-semibold">{report.donation.project.title}</strong> by {report.donation.project.ngo.orgName}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">
                          {new Date(report.sentAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </div>

                      <ReadMoreNarrative narrative={report.aiGeneratedNarrative} limit={150} />
                    </article>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Right Sidebar */}
          <div className="space-y-8">
            
            {/* Followed NGOs list */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-white">Monitored Non-Profits</h3>
              
              {donor.followers.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-gray-800 rounded-xl">
                  <p className="text-xs text-gray-500">You are not following any NGOs yet.</p>
                  <Link href="/discover" className="text-[10px] text-emerald-400 font-bold hover:underline mt-2 inline-block">
                    Discover NGOs
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {donor.followers.map((follow) => (
                    <div
                      key={follow.ngo.id}
                      className="flex justify-between items-center gap-3 p-3 border border-gray-800 rounded-xl bg-gray-950/20 hover:border-gray-700 transition"
                    >
                      <div className="space-y-0.5 truncate">
                        <Link
                          href={`/ngo/${follow.ngo.id}`}
                          className="text-xs font-extrabold text-white hover:text-emerald-400 transition-colors block truncate"
                          title={follow.ngo.orgName}
                        >
                          {follow.ngo.orgName}
                        </Link>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-500 uppercase tracking-wider">
                            Health score:
                          </span>
                          <span className="text-[10px] font-bold text-emerald-400">
                            {follow.ngo.healthScore ? `${Number(follow.ngo.healthScore).toFixed(0)}` : "Pending"}
                          </span>
                        </div>
                      </div>
                      <Link
                        href={`/ngo/${follow.ngo.id}`}
                        className="bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/20 font-bold px-2.5 py-1.5 rounded-lg text-[9px] transition whitespace-nowrap"
                      >
                        Visit Profile
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Links / Help */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-white">Donor Resources</h3>
              <ul className="space-y-3 text-xs">
                <li>
                  <a
                    href="/faq"
                    className="text-gray-400 hover:text-emerald-400 font-medium transition-colors flex items-center gap-2"
                  >
                    <span>❓</span> FAQ & Donation Verification
                  </a>
                </li>
                <li>
                  <a
                    href="/legal"
                    className="text-gray-400 hover:text-emerald-400 font-medium transition-colors flex items-center gap-2"
                  >
                    <span>🛡️</span> 80G Tax Deductions Rules
                  </a>
                </li>
                <li>
                  <a
                    href="/about"
                    className="text-gray-400 hover:text-emerald-400 font-medium transition-colors flex items-center gap-2"
                  >
                    <span>📊</span> How Milestone Auditing Works
                  </a>
                </li>
              </ul>
            </div>

          </div>

        </div>

      </main>
    </div>
  );
}
