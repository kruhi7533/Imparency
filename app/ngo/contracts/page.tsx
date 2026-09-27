import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-600 dark:text-gray-300", label: "Draft" },
  PROPOSED: { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-400", label: "Action Required" },
  UNDER_REVIEW: { bg: "bg-purple-100 dark:bg-purple-950/40", text: "text-purple-700 dark:text-purple-400", label: "Under Review" },
  ACTIVE: { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400", label: "Active" },
  COMPLETED: { bg: "bg-blue-100 dark:bg-blue-950/40", text: "text-blue-700 dark:text-blue-400", label: "Completed" },
  TERMINATED: { bg: "bg-red-100 dark:bg-red-950/40", text: "text-red-700 dark:text-red-400", label: "Terminated" },
  REJECTED: { bg: "bg-rose-100 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-400", label: "Rejected" },
};

export default async function NgoContractsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "NGO") {
    redirect("/login?callbackUrl=/ngo/contracts");
  }

  const userId = session.user.id;

  // Resolve NGO profile
  const ngoProfile = await prisma.nGOProfile.findUnique({
    where: { userId },
  });

  let ngoId = ngoProfile?.id;
  if (!ngoId) {
    const membership = await prisma.nGOTeamMember.findFirst({
      where: { userId },
      select: { ngoId: true },
    });
    ngoId = membership?.ngoId;
  }

  if (!ngoId) {
    redirect("/ngo/register");
  }

  const contracts = await (prisma as any).contract.findMany({
    where: { ngoId },
    orderBy: { createdAt: "desc" },
    include: {
      donor: { select: { id: true, name: true, email: true, companyName: true, isCorporate: true, donorPersona: true } },
      project: { select: { id: true, title: true, location: true, causeCategory: true } },
      milestones: { select: { id: true, title: true, allocatedAmount: true, status: true } },
    },
  });

  const totalCommitted = (contracts as any[]).reduce((sum: number, c: any) => sum + Number(c.totalGrantAmount), 0);
  const activeCount = (contracts as any[]).filter((c: any) => c.status === "ACTIVE").length;
  const pendingActionCount = (contracts as any[]).filter((c: any) => (c.status === "PROPOSED" || c.status === "DRAFT") && !c.ngoSignedAt).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Link href="/ngo/dashboard" className="text-xs font-bold text-emerald-600 hover:underline">
              ← Back to NGO Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">Grant Contracts & Agreements</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Institutional grant agreements, counter-signing, and milestone tranche management.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Institutional Grants</p>
            <p className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1">
              ₹{totalCommitted.toLocaleString("en-IN")}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Active Agreements</p>
            <p className="text-2xl font-extrabold text-emerald-600 mt-1">{activeCount}</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pending Execution</p>
            <p className="text-2xl font-extrabold text-amber-500 mt-1">{pendingActionCount}</p>
          </div>
        </div>

        {/* Contracts Table */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
          {contracts.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white">No grant agreements yet</h3>
              <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                When institutional donors propose grant agreements for your opportunities, they will appear here for review and counter-signing.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <tr>
                    <th className="px-4 py-3">Agreement & Opportunity</th>
                    <th className="px-4 py-3">Grantor / Donor Organization</th>
                    <th className="px-4 py-3">Grant Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">NGO Signature</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {contracts.map((c: any) => {
                    const badge = STATUS_BADGE[c.status] || STATUS_BADGE.DRAFT;
                    const ngoSigned = !!c.ngoSignedAt;

                    return (
                      <tr key={c.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                        <td className="px-4 py-4">
                          <Link href={`/donor/contracts/${c.id}`} className="font-bold text-gray-900 dark:text-white hover:text-emerald-600 transition block">
                            {c.title}
                          </Link>
                          <span className="text-xs font-mono text-gray-400 block mt-0.5">{c.contractNumber}</span>
                          <span className="text-xs text-emerald-600 block mt-0.5">{c.project.title}</span>
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-medium text-gray-900 dark:text-white">
                            {c.donor.companyName || c.donor.name}
                          </p>
                          <p className="text-xs text-gray-400">{c.donor.email}</p>
                        </td>
                        <td className="px-4 py-4 font-bold text-gray-900 dark:text-white">
                          ₹{Number(c.totalGrantAmount).toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                              ngoSigned
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700 animate-pulse"
                            }`}
                          >
                            {ngoSigned ? "✓ Signed" : "Counter-Signature Required"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Link
                            href={`/donor/contracts/${c.id}`}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                          >
                            Review & Sign →
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
      </div>
    </div>
  );
}
