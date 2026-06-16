"use client";

import React, { useState } from "react";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";

interface Donation {
  id: string;
  amount: number;
  createdAt: string;
  project: {
    id: string;
    title: string;
    causeCategory: string;
    ngo: {
      orgName: string;
    };
  };
  taxReceipt: {
    id: string;
    pdfUrl: string;
    receiptNumber: string;
  } | null;
}

interface FollowedNGO {
  ngo: {
    id: string;
    orgName: string;
    healthScore: number | null;
    description: string;
    causeCategories: string[];
  };
}

interface ActiveProject {
  id: string;
  title: string;
  raisedAmount: number;
  targetAmount: number;
}

interface CSRSummaryItem {
  financialYear: string;
  totalAmount: number;
}

interface CSRProjectItem {
  projectId: string;
  projectTitle: string;
  ngoName: string;
  amountDonated: number;
  milestonesCompleted: number;
  milestonesPending: number;
  averageAiScore: number | null;
}

interface PortfolioClientProps {
  donor: {
    id: string;
    name: string;
    email: string;
    isCorporate: boolean;
    companyName: string | null;
    gstNumber: string | null;
    totalDonated: number;
  };
  donations: Donation[];
  followers: FollowedNGO[];
  activeFundedProjects: ActiveProject[];
  csrSummary: CSRSummaryItem[];
  csrProjects: CSRProjectItem[];
}

export default function PortfolioClient({
  donor,
  donations,
  followers,
  activeFundedProjects,
  csrSummary,
  csrProjects
}: PortfolioClientProps) {
  const [activeTab, setActiveTab] = useState<"ledger" | "csr">("ledger");
  const [selectedFY, setSelectedFY] = useState(
    csrSummary[0]?.financialYear || ""
  );

  const totalAmount = donor.totalDonated;
  const projectsCount = new Set(donations.map((d) => d.project.id)).size;
  const followedCount = followers.length;

  const exportCSV = () => {
    if (csrProjects.length === 0) return;

    const headers = [
      "NGO Name",
      "Project Name",
      "Amount Donated (INR)",
      "Milestones Completed",
      "Milestones Pending",
      "Average AI Proof Score"
    ];

    const rows = csrProjects.map((p) => [
      `"${p.ngoName.replace(/"/g, '""')}"`,
      `"${p.projectTitle.replace(/"/g, '""')}"`,
      p.amountDonated.toString(),
      p.milestonesCompleted.toString(),
      p.milestonesPending.toString(),
      p.averageAiScore !== null ? p.averageAiScore.toString() : "N/A"
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CSR_Compliance_Report_${donor.companyName || "Company"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <Navbar />

      {/* Hero Header */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10"></div>

        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
              <span>My Impact Portfolio</span>
              {donor.isCorporate && (
                <span className="text-[10px] font-black tracking-wider px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-full uppercase">
                  CSR Account
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-400">
              Welcome back, <span className="text-gray-900 dark:text-white font-bold">{donor.companyName || donor.name}</span>. Trace your transparency footprint.
            </p>
          </div>

          <div className="flex gap-4">
            <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl text-center shadow-inner">
              <span className="block text-xl font-black text-emerald-600 dark:text-emerald-400">
                ₹{totalAmount.toLocaleString("en-IN")}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Total Contributed</span>
            </div>
            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-2xl text-center">
              <span className="block text-xl font-black text-gray-900 dark:text-white">
                {projectsCount}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Projects Funded</span>
            </div>
            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-2xl text-center">
              <span className="block text-xl font-black text-gray-900 dark:text-white">
                {followedCount}
              </span>
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">NGOs Followed</span>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Navigation Tabs for Corporates */}
        {donor.isCorporate && (
          <div className="flex border-b border-gray-200 dark:border-gray-800 mb-8">
            <button
              onClick={() => setActiveTab("ledger")}
              className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px ${
                activeTab === "ledger"
                  ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              Donations Ledger
            </button>
            <button
              onClick={() => setActiveTab("csr")}
              className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px flex items-center gap-2 ${
                activeTab === "csr"
                  ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              CSR Corporate Portal
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-8">
            {activeTab === "ledger" ? (
              /* STANDARD LEDGER TAB */
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Donations Ledger</h2>
                  <p className="text-xs text-gray-400">Chronological history of your verified contributions and tax receipts.</p>
                </div>

                {donations.length === 0 ? (
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
                    {donations.map((donation) => (
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
                              ₹{donation.amount.toLocaleString("en-IN")}
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
            ) : (
              /* CSR COMPLIANCE TAB */
              <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">CSR Compliance Portal</h2>
                    <p className="text-xs text-gray-400">Track milestones verification, average AI verification audits, and export audit reports.</p>
                  </div>
                  {csrProjects.length > 0 && (
                    <button
                      onClick={exportCSV}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-4 rounded-xl text-xs shadow transition flex items-center gap-1 whitespace-nowrap"
                    >
                      📊 Export CSV Report
                    </button>
                  )}
                </div>

                {/* Utilization Certificate Selector */}
                {csrSummary.length > 0 && (
                  <div className="p-4 bg-emerald-50/20 dark:bg-emerald-950/10 border border-emerald-100/40 dark:border-emerald-900/30 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300">Download Annual CSR Utilization Certificate</h4>
                      <p className="text-[10px] text-gray-400">Download the compliance certificate signed and stamped for tax and board audit purposes.</p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <select
                        value={selectedFY}
                        onChange={(e) => setSelectedFY(e.target.value)}
                        className="px-3 py-2 border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-xl text-xs dark:text-white focus:outline-none"
                      >
                        {csrSummary.map((fyItem) => (
                          <option key={fyItem.financialYear} value={fyItem.financialYear}>
                            FY {fyItem.financialYear}
                          </option>
                        ))}
                      </select>
                      <a
                        href={`/api/donations/csr-certificate?fy=${selectedFY}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 border border-emerald-100 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 font-bold px-4 py-2 rounded-xl text-xs text-center transition flex-1 sm:flex-initial"
                      >
                        Download PDF
                      </a>
                    </div>
                  </div>
                )}

                {/* Projects Table */}
                {csrProjects.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No CSR expenditures recorded yet.</p>
                ) : (
                  <div className="border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                        <thead className="bg-gray-50 dark:bg-gray-800/50">
                          <tr>
                            <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Project / NGO</th>
                            <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Spend</th>
                            <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Milestones</th>
                            <th className="px-4 py-3 text-right text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">AI Verified Score</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                          {csrProjects.map((p) => (
                            <tr key={p.projectId} className="hover:bg-gray-50/20 dark:hover:bg-gray-800/5">
                              <td className="px-4 py-4">
                                <div className="text-xs font-bold text-gray-900 dark:text-white truncate max-w-[180px]" title={p.projectTitle}>
                                  {p.projectTitle}
                                </div>
                                <div className="text-[9px] text-gray-400 truncate max-w-[180px]">
                                  {p.ngoName}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-xs font-black text-gray-900 dark:text-white">
                                ₹{p.amountDonated.toLocaleString("en-IN")}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="flex gap-1.5 items-center">
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded">
                                    {p.milestonesCompleted} Comp
                                  </span>
                                  {p.milestonesPending > 0 && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-450 rounded">
                                      {p.milestonesPending} Pend
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-right">
                                {p.averageAiScore !== null ? (
                                  <span
                                    className={`text-xs font-bold px-2 py-0.5 rounded ${
                                      p.averageAiScore >= 70
                                        ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                                        : "bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400"
                                    }`}
                                  >
                                    {p.averageAiScore}/100
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-gray-400 italic">No verification</span>
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
            )}
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
                    const raised = project.raisedAmount;
                    const target = project.targetAmount;
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
                          <span>₹{raised.toLocaleString("en-IN")} raised</span>
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
              {followers.length === 0 ? (
                <p className="text-xs text-gray-400">You are not following any NGOs yet.</p>
              ) : (
                <div className="space-y-4">
                  {followers.map((follow) => (
                    <div key={follow.ngo.id} className="flex justify-between items-center gap-3">
                      <div className="space-y-0.5 truncate">
                        <Link href={`/ngo/${follow.ngo.id}`} className="text-xs font-extrabold text-gray-900 dark:text-white hover:text-emerald-600 transition block truncate">
                          {follow.ngo.orgName}
                        </Link>
                        <span className="text-[9px] text-gray-400">
                          Health Score: {follow.ngo.healthScore !== null ? `${follow.ngo.healthScore.toFixed(0)}` : "Pending"}
                        </span>
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
