import prisma from "@/lib/prisma";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { getAllComplianceSummaries } from "@/lib/compliance-agent";
import RiskComplianceClient from "./RiskComplianceClient";

export const runtime = "nodejs";

export default async function RiskCompliancePage() {
  // The platform alert sweep (deadline-exceeded milestones, inactive funded
  // campaigns) used to run here, awaited before this page fetched anything.
  // Measured at 466ms against 158ms for the page's own data — three quarters
  // of the wait was maintenance work. It now runs on a schedule instead:
  // `app/api/cron/risk-sweep`. Alerts it raises appear on the next sweep
  // rather than the next page load; its thresholds are 30 and 60 days, so
  // that delay changes nothing operationally.
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
      // Investigations are shown whatever their outcome, including FAILED and
      // ones that filed nothing — a queue that only lists hits gives no way to
      // judge how often the investigator is right.
      prisma.fraudInvestigation.findMany({
        include: { ngo: { select: { orgName: true } } },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
    ]);
  } catch (err: any) {
    // P2021 = table missing, P2022 = column missing: the database schema is
    // behind this branch's prisma schema. Show an actionable message instead of
    // a blank 500 that takes down the whole admin console.
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Risk & Compliance failed to load" detail={err?.meta?.table || err?.meta?.column || err?.message} />;
    }
    throw err;
  }
  const [allUnresolved, resolvedAlerts, riskReviews, complianceSummaries, investigations] = data;

  const severityRank: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };
  const sorted = [...allUnresolved].sort(
    (a, b) => (severityRank[a.severity] || 4) - (severityRank[b.severity] || 4)
  );

  const serialize = (a: typeof allUnresolved[0]) => ({ ...a, createdAt: a.createdAt.toISOString() });

  // Per-alert investigation status, so an admin scanning the alert list can see
  // "AI already looked at this" without opening the separate Investigations tab
  // or clicking Investigate themselves. Three sources, newest-first (investigations
  // is already ordered that way), first match wins:
  //   1. FraudInvestigation.alertId — the direct link (added in the
  //      add_alertid_to_fraud_investigation migration). Covers every outcome,
  //      auto-triggered or manual, clean or flagged.
  //   2. triggeredBy === "alert:<id>" — fallback for rows seeded before that
  //      migration existed, which have alertId = null but still encode it here.
  //   3. RiskReview.alertIds — covers a finding filed under a DIFFERENT alertId
  //      that got attached to this one too (debounce reuse).
  const investigationStatusByAlertId: Record<
    string,
    { status: string; riskLevel: string | null; summary: string | null }
  > = {};
  for (const inv of investigations as any[]) {
    const alertId: string | null =
      inv.alertId ??
      (typeof inv.triggeredBy === "string" && inv.triggeredBy.startsWith("alert:")
        ? inv.triggeredBy.slice("alert:".length)
        : null);
    if (alertId) {
      // Investigations are already ordered newest-first; keep the first (latest) hit.
      if (!investigationStatusByAlertId[alertId]) {
        investigationStatusByAlertId[alertId] = { status: inv.status, riskLevel: inv.riskLevel, summary: inv.summary };
      }
    }
  }
  for (const review of riskReviews as any[]) {
    for (const alertId of review.alertIds ?? []) {
      if (!investigationStatusByAlertId[alertId]) {
        investigationStatusByAlertId[alertId] = { status: "COMPLETED", riskLevel: review.riskLevel, summary: null };
      }
    }
  }

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
          initialInvestigations={investigations.map((i: any) => ({
            ...i,
            trace: Array.isArray(i.trace) ? i.trace : [],
            createdAt: i.createdAt.toISOString(),
          }))}
          investigationStatusByAlertId={investigationStatusByAlertId}
        />
      </main>
    </div>
  );
}
