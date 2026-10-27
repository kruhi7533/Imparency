"use client";

import React, { useState } from "react";
import Link from "next/link";

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
    <div className="font-sans">

      {/* Hero Header */}
      <section className="pt-8 sm:pt-10 px-4 sm:px-6 lg:px-8">

        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 flex flex-wrap items-center gap-2">
              <span>My Impact Portfolio</span>
              {donor.isCorporate && (
                <span className="font-sans text-[10px] font-semibold tracking-wider px-2 py-0.5 bg-trust-50 text-trust-700 ring-1 ring-trust-200 rounded-full uppercase">
                  CSR Account
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-600">
              Welcome back, <span className="text-gray-900 font-bold">{donor.companyName || donor.name}</span>. Trace your transparency footprint.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
            <div className="px-4 sm:px-5 py-3 bg-white border border-gray-200/80 rounded-2xl text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <span className="block text-lg sm:text-xl font-semibold text-emerald-700">
                ₹{totalAmount.toLocaleString("en-IN")}
              </span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Total Contributed</span>
            </div>
            <div className="px-4 sm:px-5 py-3 bg-white border border-gray-200/80 rounded-2xl text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <span className="block text-lg sm:text-xl font-semibold text-gray-900">
                {projectsCount}
              </span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Projects Funded</span>
            </div>
            <div className="px-4 sm:px-5 py-3 bg-white border border-gray-200/80 rounded-2xl text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <span className="block text-lg sm:text-xl font-semibold text-gray-900">
                {followedCount}
              </span>
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">NGOs Followed</span>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs for Corporates */}
        {donor.isCorporate && (
          <div className="flex border-b border-gray-200 mb-8">
            <button
              onClick={() => setActiveTab("ledger")}
              className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px ${
                activeTab === "ledger"
                  ? "border-trust-600 text-trust-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Donations Ledger
            </button>
            <button
              onClick={() => setActiveTab("csr")}
              className={`py-2.5 px-6 font-bold text-sm transition-all border-b-2 -mb-px flex items-center gap-2 ${
                activeTab === "csr"
                  ? "border-trust-600 text-trust-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
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
              <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-6">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Donations Ledger</h2>
                  <p className="text-xs text-gray-500">Chronological history of your verified contributions and tax receipts.</p>
                </div>

                {donations.length === 0 ? (
                  <div className="text-center py-12 border border-dashed border-gray-200 rounded-2xl">
                    <span className="text-4xl mb-3 block">🌱</span>
                    <h4 className="text-sm font-bold text-gray-900">Start your impact footprint</h4>
                    <p className="text-xs text-gray-500 mt-1 mb-4">You have not made any donations on ImpactBridge yet.</p>
                    <Link href="/discover" className="inline-block bg-trust-600 hover:bg-trust-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition">
                      Browse Campaigns
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {donations.map((donation) => (
                      <div key={donation.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border border-gray-200 hover:border-gray-300 rounded-2xl transition gap-4">
                        <div className="space-y-1">
                          <Link href={`/projects/${donation.project.id}`} className="text-sm font-semibold text-gray-900 hover:text-trust-700 transition block">
                            {donation.project.title}
                          </Link>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                            <span>By {donation.project.ngo.orgName}</span>
                            <span>•</span>
                            <span>{new Date(donation.createdAt).toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                          <div className="text-right">
                            <span className="text-sm font-semibold text-gray-900">
                              ₹{donation.amount.toLocaleString("en-IN")}
                            </span>
                            <span className="block text-[10px] text-emerald-600 font-semibold uppercase">Verified</span>
                          </div>

                          {donation.taxReceipt && (
                            <a
                              href={donation.taxReceipt.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 font-bold px-3 py-2 rounded-xl text-[10px] flex items-center gap-1 transition shadow-sm"
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
              <div className="bg-white border border-gray-200/80 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">CSR Compliance Portal</h2>
                    <p className="text-xs text-gray-500">Track milestones verification, average AI verification audits, and export audit reports.</p>
                  </div>
                  {csrProjects.length > 0 && (
                    <button
                      onClick={exportCSV}
                      className="bg-trust-600 hover:bg-trust-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition flex items-center gap-1 whitespace-nowrap"
                    >
                      📊 Export CSV Report
                    </button>
                  )}
                </div>

                {/* Utilization Certificate Selector */}
                {csrSummary.length > 0 && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-gray-700">Download Annual CSR Utilization Certificate</h4>
                      <p className="text-[10px] text-gray-500">Download the compliance certificate signed and stamped for tax and board audit purposes.</p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <select
                        value={selectedFY}
                        onChange={(e) => setSelectedFY(e.target.value)}
                        className="px-3 py-2 border border-gray-300 bg-white text-gray-900 rounded-lg text-xs focus:border-trust-500 focus:ring-2 focus:ring-trust-500/20 focus:outline-none"
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
                        className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 text-emerald-700 font-bold px-4 py-2 rounded-xl text-xs text-center transition flex-1 sm:flex-initial"
                      >
                        Download PDF
                      </a>
                    </div>
                  </div>
                )}

                {/* Projects Table */}
                {csrProjects.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">No CSR expenditures recorded yet.</p>
                ) : (
                  <div className="border border-gray-200/80 rounded-2xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider">Project / NGO</th>
                            <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider">Spend</th>
                            <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-wider">Milestones</th>
                            <th className="px-4 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-wider">AI Verified Score</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {csrProjects.map((p) => (
                            <tr key={p.projectId} className="hover:bg-gray-50">
                              <td className="px-4 py-4">
                                <div className="text-xs font-bold text-gray-900 truncate max-w-[180px]" title={p.projectTitle}>
                                  {p.projectTitle}
                                </div>
                                <div className="text-[10px] text-gray-500 truncate max-w-[180px]">
                                  {p.ngoName}
                                </div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap text-xs font-semibold text-gray-900">
                                ₹{p.amountDonated.toLocaleString("en-IN")}
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">
                                <div className="flex gap-1.5 items-center">
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded">
                                    {p.milestonesCompleted} Comp
                                  </span>
                                  {p.milestonesPending > 0 && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
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
                                        ? "bg-emerald-50 text-emerald-700"
                                        : "bg-amber-50 text-amber-700"
                                    }`}
                                  >
                                    {p.averageAiScore}/100
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-gray-500 italic">No verification</span>
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
            <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-4">
              <h3 className="text-sm font-bold text-gray-900">Active Campaigns</h3>
              {activeFundedProjects.length === 0 ? (
                <p className="text-xs text-gray-500">No active campaigns currently funded.</p>
              ) : (
                <div className="space-y-4">
                  {activeFundedProjects.map((project) => {
                    const raised = project.raisedAmount;
                    const target = project.targetAmount;
                    const percent = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
                    return (
                      <div key={project.id} className="space-y-1.5 p-3 border border-gray-200 rounded-xl">
                        <Link href={`/projects/${project.id}`} className="text-xs font-semibold text-gray-900 hover:text-trust-700 transition block truncate">
                          {project.title}
                        </Link>
                        <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-emerald-600 h-full rounded-full" style={{ width: `${percent}%` }}></div>
                        </div>
                        <div className="flex justify-between text-[10px] font-bold text-gray-500">
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
            <div className="bg-white border border-gray-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-4">
              <h3 className="text-sm font-bold text-gray-900">Followed Non-Profits</h3>
              {followers.length === 0 ? (
                <p className="text-xs text-gray-500">You are not following any NGOs yet.</p>
              ) : (
                <div className="space-y-4">
                  {followers.map((follow) => (
                    <div key={follow.ngo.id} className="flex justify-between items-center gap-3">
                      <div className="space-y-0.5 truncate">
                        <Link href={`/ngo/${follow.ngo.id}`} className="text-xs font-semibold text-gray-900 hover:text-trust-700 transition block truncate">
                          {follow.ngo.orgName}
                        </Link>
                        <span className="text-[10px] text-gray-500">
                          Health Score: {follow.ngo.healthScore !== null ? `${follow.ngo.healthScore.toFixed(0)}` : "Pending"}
                        </span>
                      </div>
                      <Link
                        href={`/ngo/${follow.ngo.id}`}
                        className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition font-bold px-2.5 py-1.5 rounded-lg text-[10px] border border-emerald-100"
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
