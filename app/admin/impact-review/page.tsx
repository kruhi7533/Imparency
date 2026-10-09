import prisma from "@/lib/prisma";
import { BadgeCheck, ScanSearch, Inbox } from "lucide-react";
import { triageOutcomeClaim, verdictLabel, type TriageResult } from "@/lib/outcome-triage";
import { resolveCitations, evidenceAlreadyCounted } from "@/lib/outcome-evidence";
import { UNIT_LABELS } from "@/lib/metric-registry";
import ImpactClaimActions from "./ImpactClaimActions";

/**
 * /admin/impact-review — the outcome-claim approval queue.
 *
 * Every SUBMITTED claim, each with its triage findings already computed, so the
 * admin reads conclusions instead of doing the research. The verdict is the
 * organising idea: CLEAN means "the checks passed, confirm it", NEEDS_REVIEW
 * means "here is what I could not settle", BLOCKED means "this cannot be
 * approved and here is why".
 *
 * The queue is capped and windowed in the same shape as /admin/proof-review
 * (which learned this the hard way in Week 7 — an unbounded findMany with four
 * levels of include on every page load). Triage runs per claim and costs
 * queries, so the cap is the thing that keeps this page from degrading as the
 * pilot fills up.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUEUE_LIMIT = 50;

const TONE: Record<"good" | "warn" | "bad", string> = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:ring-emerald-900/40",
  warn: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:ring-amber-900/40",
  bad: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-900/40",
};

const SEVERITY_TONE: Record<string, string> = {
  BLOCK: "text-red-700 dark:text-red-400",
  HIGH: "text-amber-700 dark:text-amber-400",
  MEDIUM: "text-gray-600 dark:text-gray-400",
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function ImpactReviewPage() {
  const claims = await prisma.outcomeClaim.findMany({
    where: { status: "SUBMITTED" },
    orderBy: { submittedAt: "asc" },
    take: QUEUE_LIMIT,
    select: {
      id: true,
      value: true,
      unit: true,
      method: true,
      periodStart: true,
      periodEnd: true,
      submittedAt: true,
      metricCode: true,
      metric: { select: { code: true, name: true, unit: true, status: true, requiredEvidence: true } },
      project: { select: { id: true, title: true, ngo: { select: { orgName: true } } } },
      milestone: { select: { title: true } },
      citations: { select: { id: true, kind: true, proofId: true, evidenceId: true, feedbackId: true } },
    },
  });

  const totalSubmitted = await prisma.outcomeClaim.count({ where: { status: "SUBMITTED" } });

  // Triage each claim. Sequential rather than Promise.all: each claim runs
  // several queries of its own, and twenty claims fanning out at once against
  // a pooled Neon connection is how this page would start timing out.
  const triaged: { claim: (typeof claims)[number]; triage: TriageResult }[] = [];
  for (const claim of claims) {
    const [resolved, alreadyCounted] = await Promise.all([
      resolveCitations(claim.citations),
      evidenceAlreadyCounted(claim.metricCode, claim.id),
    ]);
    triaged.push({
      claim,
      triage: triageOutcomeClaim({
        claim: {
          id: claim.id,
          value: claim.value.toString(),
          unit: claim.unit,
          periodStart: claim.periodStart,
          periodEnd: claim.periodEnd,
        },
        metric: claim.metric,
        citations: resolved,
        evidenceCitedByApprovedClaims: alreadyCounted,
      }),
    });
  }

  const blocked = triaged.filter((t) => t.triage.verdict === "BLOCKED").length;
  const needsReview = triaged.filter((t) => t.triage.verdict === "NEEDS_REVIEW").length;
  const clean = triaged.filter((t) => t.triage.verdict === "CLEAN").length;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <ScanSearch className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Impact review</h1>
        </div>
        <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Numbers organisations have reported against governed metrics, each checked against the
          evidence cited for it. Only an approved claim becomes a figure in a donor report — and a
          claim the checks block cannot be approved here at all.
        </p>
        {claims.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {clean} passed every check · {needsReview} need your judgement · {blocked} cannot be
            approved
            {totalSubmitted > QUEUE_LIMIT && ` · showing the oldest ${QUEUE_LIMIT} of ${totalSubmitted}`}
          </p>
        )}
      </header>

      {claims.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
          <Inbox className="mx-auto h-6 w-6 text-gray-400" />
          <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">Nothing waiting.</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Outcome claims appear here once an organisation submits one for review.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {triaged.map(({ claim, triage }) => {
            const label = verdictLabel(triage.verdict);
            return (
              <article
                key={claim.id}
                className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${TONE[label.tone]}`}
                      >
                        {label.text}
                      </span>
                      <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {claim.metric.code}
                      </code>
                    </div>
                    <h2 className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                      {claim.value.toString()}{" "}
                      <span className="text-base font-normal text-gray-500 dark:text-gray-400">
                        {UNIT_LABELS[claim.unit]} · {claim.metric.name}
                      </span>
                    </h2>
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      {claim.project.ngo.orgName} · {claim.project.title}
                      {claim.milestone ? ` · ${claim.milestone.title}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                      Reporting period {fmtDate(claim.periodStart)} – {fmtDate(claim.periodEnd)} ·{" "}
                      {claim.citations.length} citation{claim.citations.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <ImpactClaimActions
                    claimId={claim.id}
                    blocked={triage.verdict === "BLOCKED"}
                    needsReview={triage.verdict === "NEEDS_REVIEW"}
                  />
                </div>

                <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/40">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    How the organisation says it counted
                  </p>
                  <p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{claim.method}</p>
                </div>

                <div className="mt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500">
                    Evidence checks
                  </p>
                  {triage.findings.length === 0 ? (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                      <BadgeCheck className="h-4 w-4" />
                      Every cited item is approved, none is counted elsewhere, and the metric&apos;s
                      evidence requirement is met.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {triage.findings.map((f) => (
                        <li key={f.code} className={`text-sm ${SEVERITY_TONE[f.severity]}`}>
                          <span className="font-semibold">
                            {f.severity === "BLOCK" ? "Blocks approval" : f.severity === "HIGH" ? "Serious" : "Worth asking"}
                          </span>
                          {" — "}
                          {f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
