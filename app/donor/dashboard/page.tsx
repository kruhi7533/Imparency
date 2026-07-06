import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DonorDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/dashboard");
  }

  const userId = session.user.id;

  const donor = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      donations: {
        where: { status: "SUCCESS" },
      },
      followers: true,
    },
  });

  if (!donor) {
    redirect("/login");
  }

  const totalDonated = donor.donations.reduce((sum, d) => sum + Number(d.amount), 0);
  const successCount = donor.donations.length;
  const followedCount = donor.followers.length;

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case "MAJOR_DONOR":
        return "Major Donor";
      case "COMMITTED":
        return "Committed";
      default:
        return "Standard";
    }
  };

  const stats = [
    { label: "Total Donated", value: `Rs.${totalDonated.toLocaleString("en-IN")}`, sub: "across all NGOs" },
    { label: "Donations", value: successCount.toString(), sub: "successful payments" },
    { label: "NGOs Followed", value: followedCount.toString(), sub: "organizations" },
    { label: "Donor Tier", value: getTierLabel(donor.donorTier), sub: "tier status" },
  ];

  // Fetch recent impact reports for this donor
  const recentReports = await prisma.impactReport.findMany({
    where: { donorId: userId },
    orderBy: { sentAt: "desc" },
    take: 3,
    include: {
      donation: {
        select: {
          amount: true,
          project: {
            select: {
              title: true,
              ngo: { select: { orgName: true } },
            },
          },
        },
      },
      milestone: {
        select: {
          title: true,
        },
      },
    },
  });

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto text-left">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Impact Portfolio</h1>
        <p className="text-gray-400 text-sm mt-1">
          Your complete giving history and verified impact
        </p>
      </div>

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
        <h2 className="text-sm font-bold text-white mb-4">Recent Impact Reports</h2>
        {recentReports.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-sm">
            Impact reports will appear here after your first donation milestone is verified.
          </div>
        ) : (
          <div className="space-y-4">
            {recentReports.map((report) => (
              <div key={report.id} className="p-4 rounded-xl bg-gray-950 border border-gray-800 space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span className="font-bold text-emerald-400">
                    {report.donation?.project?.ngo?.orgName || "Verified NGO"}
                  </span>
                  <span>{new Date(report.sentAt).toLocaleDateString()}</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  Milestone Completed: {report.milestone?.title || "Project Milestone"}
                </h3>
                <p className="text-xs text-gray-300 leading-relaxed">
                  {report.aiGeneratedNarrative}
                </p>
                {report.sdgTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {report.sdgTags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/30"
                      >
                        {tag}
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
