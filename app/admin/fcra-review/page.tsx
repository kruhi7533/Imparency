import prisma from "@/lib/prisma";
import FCRAReviewClient from "./FCRAReviewClient";

export const runtime = "nodejs";

export default async function AdminFcraReviewPage() {
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
