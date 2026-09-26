import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import DonorContractsClient from "@/app/donor/contracts/DonorContractsClient";

export const dynamic = "force-dynamic";

export default async function DonorContractsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/contracts");
  }

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        session.user.id ? { id: session.user.id } : undefined,
        session.user.email ? { email: session.user.email } : undefined,
      ].filter(Boolean) as any,
    },
  });

  if (!user && session.user.email) {
    user = await prisma.user.create({
      data: {
        id: session.user.id || undefined,
        email: session.user.email,
        name: session.user.name || "Donor User",
        role: "DONOR",
        passwordHash: "oauth-or-session-restored",
      },
    });
  }

  const userId = user?.id || session.user.id;
  const statusFilter = searchParams.status;
  const q = searchParams.q?.trim() || "";

  const where: any = { donorId: userId };
  if (statusFilter && statusFilter !== "ALL") {
    where.status = statusFilter;
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { contractNumber: { contains: q, mode: "insensitive" } },
      { project: { title: { contains: q, mode: "insensitive" } } },
      { ngo: { orgName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [contracts, allDonorContracts] = await Promise.all([
    (prisma as any).contract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        ngo: { select: { id: true, orgName: true, logo_url: true, panNumber: true } },
        project: { select: { id: true, title: true, location: true, coverImage: true, causeCategory: true } },
        milestones: { select: { id: true, title: true, allocatedAmount: true, status: true } },
      },
    }),
    (prisma as any).contract.findMany({
      where: { donorId: userId },
      select: {
        id: true,
        status: true,
        totalGrantAmount: true,
        milestones: { select: { allocatedAmount: true, status: true } },
      },
    }),
  ]);

  // Aggregate stats
  const totalCommitted = (allDonorContracts as any[]).reduce(
    (acc: number, c: any) => (c.status !== "TERMINATED" && c.status !== "REJECTED" ? acc + Number(c.totalGrantAmount) : acc),
    0
  );
  const activeCount = (allDonorContracts as any[]).filter((c: any) => c.status === "ACTIVE").length;
  const proposedCount = (allDonorContracts as any[]).filter((c: any) => c.status === "PROPOSED" || c.status === "DRAFT" || c.status === "UNDER_REVIEW").length;
  const completedCount = (allDonorContracts as any[]).filter((c: any) => c.status === "COMPLETED").length;

  const serializedContracts = (contracts as any[]).map((c: any) => ({
    ...c,
    totalGrantAmount: Number(c.totalGrantAmount),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    startDate: c.startDate ? c.startDate.toISOString() : null,
    endDate: c.endDate ? c.endDate.toISOString() : null,
    donorSignedAt: c.donorSignedAt ? c.donorSignedAt.toISOString() : null,
    ngoSignedAt: c.ngoSignedAt ? c.ngoSignedAt.toISOString() : null,
    milestones: (c.milestones || []).map((m: any) => ({
      ...m,
      allocatedAmount: Number(m.allocatedAmount),
    })),
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header with CTA */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contracts & Grant Agreements</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Structure, review, and execute milestone-based grants for funded social opportunities.
            </p>
          </div>
          <Link
            href="/donor/contracts/new"
            className="inline-flex items-center justify-center px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm transition"
          >
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Draft New Contract
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Committed</p>
            <p className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1">
              ₹{totalCommitted.toLocaleString("en-IN")}
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Active & completed grants</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Active Agreements</p>
            <p className="text-2xl font-extrabold text-emerald-600 mt-1">{activeCount}</p>
            <p className="text-xs text-gray-400 mt-1">Dual-signed & operational</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">In Review / Proposed</p>
            <p className="text-2xl font-extrabold text-amber-500 mt-1">{proposedCount}</p>
            <p className="text-xs text-gray-400 mt-1">Awaiting signature or terms</p>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Completed</p>
            <p className="text-2xl font-extrabold text-blue-600 mt-1">{completedCount}</p>
            <p className="text-xs text-gray-400 mt-1">All milestones fulfilled</p>
          </div>
        </div>

        {/* Client Interactive Filter & List */}
        <DonorContractsClient contracts={serializedContracts} initialStatus={statusFilter || "ALL"} initialQuery={q} />
      </div>
    </div>
  );
}
