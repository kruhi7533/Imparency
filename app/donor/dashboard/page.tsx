import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { computeDonorTier } from "@/lib/engagement-utils";
import ReadMoreNarrative from "./components/ReadMoreNarrative";
import ReEngagementCard from "./components/ReEngagementCard";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DonorDashboardPage({
  searchParams,
}: {
  searchParams: { reEngagement?: string; payment?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/dashboard");
  }

  const userId = session.user.id;

  // Fetch donor user data along with their successful donations, followed NGOs, and impact reports.
  //
  // The re-engagement lookup goes in the same round trip: it keys off userId
  // and the URL, never off the donor row, so awaiting it separately only bought
  // a second trip to the database. Everything further down *does* depend on one
  // of these two results and has to stay ordered.
  const [donor, activeEvent] = await Promise.all([
    prisma.user.findUnique({
    where: { id: userId },
    include: {
      contracts: {
        select: {
          totalGrantAmount: true,
          status: true,
        },
      },
      donations: {
        where: { status: "SUCCESS" },
        include: {
          project: {
            select: {
              ngoId: true,
            },
          },
        },
      },
      followers: true,
      impactReports: {
        include: {
          milestone: {
            select: {
              title: true,
              deadline: true,
              project: {
                select: {
                  id: true,
                  title: true,
                  coverImage: true,
                  ngo: {
                    select: {
                      orgName: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { sentAt: "desc" },
      },
    },
    }),
    // An explicit `?reEngagement=` in the URL pins one specific event (the
    // donor followed a link from an email); otherwise show the most recent
    // undismissed one.
    searchParams.reEngagement
      ? prisma.reEngagementEvent.findFirst({
          where: {
            id: searchParams.reEngagement,
            donorId: userId,
            dismissed: false,
          },
        })
      : prisma.reEngagementEvent.findFirst({
          where: {
            donorId: userId,
            dismissed: false,
          },
          orderBy: {
            emailSentAt: "desc",
          },
        }),
  ]);

  if (!donor) {
    redirect("/login");
  }

  // Calculate stats based on real database records
  const totalAmount = Number(donor.totalDonated);
  const donationsCount = donor.donations.length;
  const followedCount = donor.followers.length;
  const tier = computeDonorTier(donationsCount, totalAmount);

  const getTierLabel = (tierName: string) => {
    switch (tierName) {
      case "MAJOR_DONOR":
        return "Major Donor";
      case "COMMITTED":
        return "Committed";
      default:
        return "Standard";
    }
  };

  const stats = [
    { label: "Total Donated", value: `₹${totalAmount.toLocaleString("en-IN")}`, sub: "across all NGOs" },
    { label: "Donations", value: String(donationsCount), sub: "successful payments" },
    { label: "NGOs Followed", value: String(followedCount), sub: "organizations" },
    { label: "Donor Tier", value: getTierLabel(tier), sub: "tier status" },
  ];

  // CSR / Corporate Governance metrics
  const isCsrOrCorporate = donor.donorPersona === "CSR_OFFICER" || donor.isCorporate;
  const csrBudgetNumber = donor.csrBudget ? Number(donor.csrBudget) : 0;
  const contractCommitments = (donor.contracts || [])
    .filter((c) => c.status === "ACTIVE" || c.status === "COMPLETED")
    .reduce((sum, c) => sum + Number(c.totalGrantAmount), 0);
  const totalUtilized = totalAmount + contractCommitments;
  const csrUtilizationPct =
    csrBudgetNumber > 0 ? Math.min(100, Math.round((totalUtilized / csrBudgetNumber) * 100)) : 0;

  // Find referred NGO details if the path is NGO_REFERRAL
  let referredNgoName = null;
  let referredNgoId = null;
  let referredNgoCategories: string[] = [];
  let referredNgoDescription = null;

  if (activeEvent && activeEvent.path === "NGO_REFERRAL") {
    const report = await prisma.impactReport.findUnique({
      where: { id: activeEvent.reportId },
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

    if (report) {
      const donatedNgoIds = donor.donations.map((d) => d.project.ngoId);
      const referredNGO = await prisma.nGOProfile.findFirst({
        where: {
          verificationStatus: "VERIFIED",
          isDeleted: false,
          id: { notIn: donatedNgoIds },
          causeCategories: {
            hasSome: report.donation.project.ngo.causeCategories,
          },
        },
        orderBy: { healthScore: "desc" },
        select: {
          id: true,
          orgName: true,
          causeCategories: true,
          description: true,
        },
      });

      if (referredNGO) {
        referredNgoName = referredNGO.orgName;
        referredNgoId = referredNGO.id;
        referredNgoCategories = referredNGO.causeCategories;
        referredNgoDescription = referredNGO.description;
      }
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto text-left">
      
      {/* Page header */}
      <div className="mb-8 flex justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Impact Portfolio</h1>
          <p className="text-gray-400 text-sm mt-1">
            Your complete giving history and verified impact
          </p>
        </div>
        <Link
          href="/donor/portfolio"
          className="text-xs font-bold text-emerald-405 hover:text-emerald-300 border border-emerald-500/20 bg-emerald-950/30 px-3 py-2 rounded-xl transition flex items-center gap-1.5 shrink-0 shadow-sm"
        >
          Detailed Portfolio <span>➔</span>
        </Link>
      </div>

      {/* Celebrations/Banner Alerts */}
      {searchParams.payment === "success" && (
        <div className="mb-6 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex items-start gap-3 text-left">
          <span className="text-xl">🎉</span>
          <div>
            <h4 className="font-extrabold text-sm text-white">Donation Successful!</h4>
            <p className="text-xs text-gray-400 mt-0.5">
              Thank you for your generous contribution. Your payment was processed successfully and your impact metrics have been updated.
            </p>
          </div>
        </div>
      )}

      {/* Re-engagement CTA card */}
      {activeEvent && (
        <ReEngagementCard
          eventId={activeEvent.id}
          path={activeEvent.path}
          referredNgoName={referredNgoName}
          referredNgoId={referredNgoId}
          referredNgoCategories={referredNgoCategories}
          referredNgoDescription={referredNgoDescription}
        />
      )}

      {/* CSR Governance & Annual Budget Utilization Banner */}
      {isCsrOrCorporate && (
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-emerald-950/40 border border-emerald-500/30 shadow-sm relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-800 pb-4 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  CSR / Corporate Profile
                </span>
                {donor.companyName && (
                  <span className="text-sm font-bold text-white">{donor.companyName}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-400">
                {donor.gstNumber && <span>GSTIN: <span className="font-mono text-gray-300 font-bold">{donor.gstNumber}</span></span>}
                {donor.csrRegistrationNumber && (
                  <>
                    <span>·</span>
                    <span>MCA Form CSR-1: <span className="font-mono text-gray-300 font-bold">{donor.csrRegistrationNumber}</span></span>
                  </>
                )}
              </div>
            </div>

            <a
              href="/api/donations/csr-certificate"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center px-4 py-2 bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-sm transition shrink-0"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download CSR Utilization Certificate
            </a>
          </div>

          {csrBudgetNumber > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">
                  Section 135 Budget Utilized: <span className="font-bold text-white">₹{totalUtilized.toLocaleString("en-IN")}</span> / ₹{csrBudgetNumber.toLocaleString("en-IN")}
                </span>
                <span className="font-bold text-emerald-400">{csrUtilizationPct}% Utilized</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${csrUtilizationPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats row — 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-gray-900 border border-gray-800 rounded-2xl p-4 shadow-sm relative overflow-hidden"
          >
            <div className="text-xs text-gray-500 mb-1">{stat.label}</div>
            <div className="text-xl font-black text-white">{stat.value}</div>
            <div className="text-[10px] text-gray-600 mt-0.5">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Impact reports feed */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 relative overflow-hidden">
        <h2 className="text-sm font-bold text-white mb-6">Recent Impact Reports</h2>
        
        {donor.impactReports.length === 0 ? (
          <div className="text-center py-8 text-gray-605 text-sm">
            Impact reports will appear here after your first donation milestone is verified.
          </div>
        ) : (
          <div className="space-y-6">
            {donor.impactReports.map((report) => (
              <div
                key={report.id}
                className="p-5 border border-gray-800/80 hover:border-gray-700 bg-gray-950/20 rounded-xl space-y-4 transition"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-800/50 pb-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-white hover:text-emerald-400 transition">
                      <Link href={`/projects/${report.milestone.project.id}`}>
                        {report.milestone.project.title}
                      </Link>
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-emerald-400 font-bold">
                      <span>{report.milestone.project.ngo.orgName}</span>
                      <span className="text-gray-700">•</span>
                      <span className="text-gray-500 font-normal">Milestone: {report.milestone.title}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 self-start sm:self-auto shrink-0 font-medium">
                    Reported on {new Date(report.sentAt).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>

                <ReadMoreNarrative narrative={report.aiGeneratedNarrative} limit={200} />

                {/* SDG and IRIS Tags */}
                {(report.sdgTags.length > 0 || report.irisMetrics.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {report.sdgTags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] font-extrabold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      >
                        {tag.startsWith("#") ? tag : `#${tag}`}
                      </span>
                    ))}
                    {report.irisMetrics.map((metric) => (
                      <span
                        key={metric}
                        className="text-[9px] font-extrabold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      >
                        IRIS: {metric}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
