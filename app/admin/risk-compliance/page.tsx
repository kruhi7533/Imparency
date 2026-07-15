import prisma from "@/lib/prisma";
import { checkGeneralPlatformAlerts } from "@/lib/risk-agent";
import { getAllComplianceSummaries } from "@/lib/compliance-agent";
import RiskComplianceClient from "./RiskComplianceClient";

export const runtime = "nodejs";

function SchemaOutOfSync({ detail }: { detail?: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-900/40 rounded-2xl shadow-sm p-8">
        <h1 className="text-xl font-extrabold text-gray-900 dark:text-white">Database schema is out of sync</h1>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          A table or column this page needs doesn&apos;t exist in the connected database yet.
          Your branch&apos;s Prisma schema is ahead of the database.
        </p>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Run this, then reload:</p>
        <pre className="mt-2 rounded-lg bg-gray-900 text-emerald-300 text-sm px-4 py-3 font-mono">npm run db:sync</pre>
        {detail ? (
          <p className="mt-4 text-xs text-gray-400 font-mono break-all">Missing: {detail}</p>
        ) : null}
      </div>
    </div>
  );
}

export default async function RiskCompliancePage() {
  // Refresh platform alerts on load
  try { await checkGeneralPlatformAlerts(); } catch (err) {
    console.error("[risk-compliance] platform alert refresh failed:", err);
  }

  let data;
  try {
    data = await Promise.all([
      prisma.fraudAlert.findMany({ where: { resolved: false }, orderBy: { createdAt: "desc" } }),
      prisma.fraudAlert.findMany({ where: { resolved: true }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.riskReview.findMany({
        where: { status: { in: ["OPEN", "REVIEWED", "ESCALATED"] } },
        include: { ngo: { select: { orgName: true } } },
        orderBy: { createdAt: "desc" },
      }),
      getAllComplianceSummaries(),
    ]);
  } catch (err: any) {
    // P2021 = table missing, P2022 = column missing: the database schema is
    // behind this branch's prisma schema. Show an actionable message instead of
    // a blank 500 that takes down the whole admin console.
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync detail={err?.meta?.table || err?.meta?.column || err?.message} />;
    }
    throw err;
  }
  const [allUnresolved, resolvedAlerts, riskReviews, complianceSummaries] = data;

  const severityRank: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...allUnresolved].sort(
    (a, b) => (severityRank[a.severity] || 4) - (severityRank[b.severity] || 4)
  );

  const serialize = (a: typeof allUnresolved[0]) => ({ ...a, createdAt: a.createdAt.toISOString() });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Risk & Compliance</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Risk monitors behavioral and fraud signals. Compliance tracks KYC, FCRA, and regulatory status. Each has its own write path.
          </p>
        </div>

        <RiskComplianceClient
          initialFraudAlerts={sorted.filter(a => a.alertCategory !== "DOCUMENT_ERROR").map(serialize)}
          initialDocErrors={sorted.filter(a => a.alertCategory === "DOCUMENT_ERROR").map(serialize)}
          initialResolved={resolvedAlerts.map(serialize)}
          initialRiskReviews={riskReviews.map((r: any) => ({
            ...r,
            createdAt: r.createdAt.toISOString(),
            resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
            findings: r.findings,
          }))}
          complianceSummaries={complianceSummaries}
        />
      </main>
    </div>
  );
}
