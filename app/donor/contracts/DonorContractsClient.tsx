"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ContractItem {
  id: string;
  contractNumber: string;
  title: string;
  status: string;
  totalGrantAmount: number;
  currency: string;
  createdAt: string;
  startDate: string | null;
  endDate: string | null;
  donorSignedAt: string | null;
  ngoSignedAt: string | null;
  ngo: {
    id: string;
    orgName: string;
    logo_url: string | null;
    panNumber: string;
  };
  project: {
    id: string;
    title: string;
    location: string;
    coverImage: string | null;
    causeCategory: string;
  };
  milestones: Array<{
    id: string;
    title: string;
    allocatedAmount: number;
    status: string;
  }>;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-300", label: "Draft" },
  PROPOSED: { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-400", label: "Proposed" },
  UNDER_REVIEW: { bg: "bg-purple-100 dark:bg-purple-950/40", text: "text-purple-700 dark:text-purple-400", label: "Under Review" },
  ACTIVE: { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400", label: "Active" },
  COMPLETED: { bg: "bg-blue-100 dark:bg-blue-950/40", text: "text-blue-700 dark:text-blue-400", label: "Completed" },
  TERMINATED: { bg: "bg-red-100 dark:bg-red-950/40", text: "text-red-700 dark:text-red-400", label: "Terminated" },
  REJECTED: { bg: "bg-rose-100 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-400", label: "Rejected" },
};

export default function DonorContractsClient({
  contracts,
  initialStatus,
  initialQuery,
}: {
  contracts: ContractItem[];
  initialStatus: string;
  initialQuery: string;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [search, setSearch] = useState(initialQuery);

  const filterTabs = [
    { key: "ALL", label: "All Contracts" },
    { key: "ACTIVE", label: "Active" },
    { key: "PROPOSED", label: "Proposed" },
    { key: "DRAFT", label: "Drafts" },
    { key: "COMPLETED", label: "Completed" },
    { key: "TERMINATED", label: "Terminated" },
  ];

  const handleTabClick = (statusKey: string) => {
    setStatusFilter(statusKey);
    const params = new URLSearchParams();
    if (statusKey !== "ALL") params.set("status", statusKey);
    if (search) params.set("q", search);
    router.push(`/donor/contracts?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (search) params.set("q", search);
    router.push(`/donor/contracts?${params.toString()}`);
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-6">
      {/* Controls: Search & Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {filterTabs.map((tab) => {
            const isActive = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => handleTabClick(tab.key)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition ${
                  isActive
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-sm w-full">
          <input
            type="text"
            placeholder="Search agreement, project, NGO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3.5 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            className="px-3.5 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 text-xs font-bold rounded-xl transition"
          >
            Search
          </button>
        </form>
      </div>

      {/* Contracts List */}
      {contracts.length === 0 ? (
        <div className="text-center py-16 px-4">
          <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-gray-900 dark:text-white">No contracts found</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            {search || statusFilter !== "ALL"
              ? "No contracts match your current filters. Try resetting your search."
              : "You have not structured any grant agreements yet. Draft your first agreement linked to an NGO opportunity."}
          </p>
          <div className="mt-5">
            <Link
              href="/donor/contracts/new"
              className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition shadow-sm"
            >
              Draft Grant Agreement
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-800">
              <tr>
                <th className="px-4 py-3">Contract & Project</th>
                <th className="px-4 py-3">NGO Partner</th>
                <th className="px-4 py-3">Grant Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Signatures</th>
                <th className="px-4 py-3">Disbursement Progress</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {contracts.map((c) => {
                const badge = STATUS_BADGE[c.status] || STATUS_BADGE.DRAFT;
                const totalMilestones = c.milestones.length;
                const disbursedMilestones = c.milestones.filter((m) => m.status === "DISBURSED").length;
                const disbursedAmount = c.milestones
                  .filter((m) => m.status === "DISBURSED")
                  .reduce((sum, m) => sum + m.allocatedAmount, 0);
                const progressPct = c.totalGrantAmount > 0 ? Math.round((disbursedAmount / c.totalGrantAmount) * 100) : 0;

                const donorSigned = !!c.donorSignedAt;
                const ngoSigned = !!c.ngoSignedAt;

                return (
                  <tr key={c.id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition">
                    <td className="px-4 py-4">
                      <Link href={`/donor/contracts/${c.id}`} className="font-bold text-gray-900 dark:text-white hover:text-emerald-600 transition block">
                        {c.title}
                      </Link>
                      <span className="text-xs font-mono text-gray-400 block mt-0.5">{c.contractNumber}</span>
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 block mt-0.5">{c.project.title}</span>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-gray-900 dark:text-white">{c.ngo.orgName}</p>
                      <p className="text-xs text-gray-400">PAN: {c.ngo.panNumber}</p>
                    </td>
                    <td className="px-4 py-4 font-bold text-gray-900 dark:text-white">
                      ₹{c.totalGrantAmount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span
                          className={`w-2 h-2 rounded-full ${donorSigned ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"}`}
                          title={donorSigned ? "Donor signed" : "Donor signature pending"}
                        />
                        <span className="text-gray-500 dark:text-gray-400 text-[11px]">Donor</span>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <span
                          className={`w-2 h-2 rounded-full ${ngoSigned ? "bg-emerald-500" : "bg-gray-300 dark:bg-gray-600"}`}
                          title={ngoSigned ? "NGO signed" : "NGO signature pending"}
                        />
                        <span className="text-gray-500 dark:text-gray-400 text-[11px]">NGO</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="w-36 space-y-1">
                        <div className="flex justify-between text-[11px] text-gray-500">
                          <span>{disbursedMilestones}/{totalMilestones} milestones</span>
                          <span className="font-bold">{progressPct}%</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href={`/donor/contracts/${c.id}`}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition"
                      >
                        View & Manage →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
