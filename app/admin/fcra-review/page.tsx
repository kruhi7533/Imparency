import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import FCRAReviewClient from "./FCRAReviewClient";

export const runtime = "nodejs";

export default async function AdminFcraReviewPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  const [records, quarterlyReports] = await Promise.all([
    prisma.nGOCompliance.findMany({
      where: { fcraStatus: { not: "NONE" } },
      include: { ngo: { select: { id: true, orgName: true, user: { select: { email: true } } } } },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.fcraQuarterlyReport.findMany({
      orderBy: { generatedAt: "desc" },
    }),
  ]);

  const serialized = records.map((c) => ({
    id: c.id,
    ngoId: c.ngoId,
    orgName: c.ngo.orgName,
    email: c.ngo.user.email,
    fcraNumber: c.fcraNumber,
    fcraStatus: c.fcraStatus,
    fcraAuthority: c.fcraAuthority,
    fcraRegisteredSince: c.fcraRegisteredSince,
    fcraIssueDate: c.fcraIssueDate ? c.fcraIssueDate.toISOString() : null,
    fcraExpiryDate: c.fcraExpiryDate ? c.fcraExpiryDate.toISOString() : null,
    fcraCertificateUrl: c.fcraCertificateUrl,
    fcraExtractedData: c.fcraExtractedData as any,
    fcraAdminNote: c.fcraAdminNote,
    updatedAt: c.updatedAt.toISOString(),
  }));

  const serializedReports = quarterlyReports.map((r) => ({
    id: r.id,
    quarter: r.quarter,
    generatedAt: r.generatedAt.toISOString(),
    totalNgos: r.totalNgos,
    activeCount: r.activeCount,
    expiringSoonCount: r.expiringSoonCount,
    expiredCount: r.expiredCount,
    rejectedCount: r.rejectedCount,
    pendingCount: r.pendingCount,
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-emerald-600 tracking-tight">ImpactBridge</span>
          <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-full font-bold">Admin Console</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex gap-4 text-sm font-semibold">
            <a href="/admin/dashboard" className="text-gray-500 hover:text-emerald-600 transition">NGO Verification</a>
            <a href="/admin/proof-review" className="text-gray-500 hover:text-emerald-600 transition">Proof Review</a>
            <a href="/admin/risk-compliance" className="text-gray-500 hover:text-emerald-600 transition">Risk &amp; Compliance</a>
            <a href="/admin/fcra-review" className="text-emerald-600 hover:text-emerald-700 transition underline decoration-2 underline-offset-4">FCRA Review</a>
          </div>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700"></div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Administrator</span>
            <a href="/api/auth/signout" className="text-xs font-semibold text-gray-500 hover:text-red-500 transition">Logout</a>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">FCRA Compliance Review</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Verify NGO FCRA registrations so donors abroad can confidently contribute. AI extracts the certificate details; you make the final call.
          </p>
        </div>

        <FCRAReviewClient initialRecords={serialized} initialReports={serializedReports} />
      </main>
    </div>
  );
}
