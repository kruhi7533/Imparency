import Link from "next/link";
import prisma from "@/lib/prisma";
import { AlertTriangle, Copy, Gauge, Layers, ShieldAlert, Sigma, Timer } from "lucide-react";
import { triageOutcomeClaim, type TriageResult } from "@/lib/outcome-triage";
import {
  resolveCitations,
  approvedCitationIndex,
  alreadyCountedFrom,
  incidentsFromIndex,
} from "@/lib/outcome-evidence";
import {
  summarisePortfolio,
  registryHygiene,
  sharePercent,
  ASSERTED_STATUSES,
  type QualityClaimRow,
} from "@/lib/impact-quality";
import { UNIT_LABELS } from "@/lib/metric-registry";
import { slaLabel, slaState, slaTargetFor } from "@/lib/sla";

/**
 * /admin/impact-quality — the portfolio quality dashboard (Week 8 SPEC-4).
 *
 * Not a metric showroom. This page answers one question: **how much of what
 * this platform reports is actually backed by evidence?** Every panel is a
 * defect count, and the headline is deliberately the share that is *backed*
 * rather than the total impact claimed — a big impact number is what an
 * ungoverned platform shows, and governing it is the whole point of Week 8.
 *
 * Not to be confused with /admin/impact-health, which despite the name is
 * about donor-update DELIVERY (did the email send, did anyone open it). The two
 * answer different questions and the similar names are logged as debt in
 * docs/WEEK8-BLUEPRINT.md §6.
 *
 * Performance shape: six queries total, regardless of portfolio size. Claims,
 * metrics and the approved-citation index are one query each; citation targets
 * resolve in three batched queries for ALL claims at once via
 * `resolveCitations`. The obvious implementation — triaging each claim through
 * its own gatherer — is two round trips per claim, which at ~340ms to Singapore
 * would put a 300-claim portfolio minutes away from rendering.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How many claims the page reasons over.
 *
 * A cap is unavoidable — triage holds every claim's citations in memory — but a
 * silently truncated denominator would make the headline share a lie. So the
 * total is counted separately and the page says so out loud when it is only
 * showing a window.
 */
const WINDOW = 500;

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

/** Shares are a quality signal, so the colour follows the number. */
function shareTone(share: number | null): string {
  if (share === null) return "text-gray-400 dark:text-gray-500";
  if (share >= 0.9) return "text-emerald-600 dark:text-emerald-400";
  if (share >= 0.6) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-gray-900 dark:text-white"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <p className="mt-1 max-w-3xl text-xs text-gray-600 dark:text-gray-400">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const TH = "px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500";
const TD = "px-3 py-2 text-sm text-gray-800 dark:text-gray-200";

export default async function ImpactQualityPage() {
  const [claims, metrics, approvedIndex, assertedTotal, oldestSubmitted] = await Promise.all([
    prisma.outcomeClaim.findMany({
      where: { status: { in: ASSERTED_STATUSES } },
      orderBy: { createdAt: "desc" },
      take: WINDOW,
      select: {
        id: true,
        ngoId: true,
        value: true,
        unit: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        submittedAt: true,
        metricCode: true,
        metric: {
          select: {
            code: true,
            name: true,
            unit: true,
            status: true,
            requiredEvidence: true,
            aggregatable: true,
          },
        },
        project: { select: { ngo: { select: { orgName: true } } } },
        citations: { select: { id: true, kind: true, proofId: true, evidenceId: true, feedbackId: true } },
      },
    }),
    prisma.metricDefinition.findMany({
      select: { code: true, status: true, requiredEvidence: true },
    }),
    approvedCitationIndex(),
    prisma.outcomeClaim.count({ where: { status: { in: ASSERTED_STATUSES } } }),
    prisma.outcomeClaim.findFirst({
      where: { status: "SUBMITTED" },
      orderBy: { submittedAt: "asc" },
      select: { submittedAt: true },
    }),
  ]);

  // Every citation across every claim, resolved in three batched queries, then
  // handed back out per claim. This is the whole reason the page is fast.
  const resolvedAll = await resolveCitations(claims.flatMap((c) => c.citations));
  const resolvedById = new Map(resolvedAll.map((r) => [r.citationId, r]));

  const rows: QualityClaimRow[] = claims.map((claim) => {
    const citations = claim.citations
      .map((c) => resolvedById.get(c.id))
      .filter((r): r is NonNullable<typeof r> => !!r);

    const triage: TriageResult = triageOutcomeClaim({
      claim: {
        id: claim.id,
        value: claim.value.toString(),
        unit: claim.unit,
        periodStart: claim.periodStart,
        periodEnd: claim.periodEnd,
      },
      metric: claim.metric,
      citations,
      evidenceCitedByApprovedClaims: alreadyCountedFrom(approvedIndex, claim.metricCode, claim.id),
    });

    return {
      id: claim.id,
      ngoId: claim.ngoId,
      orgName: claim.project.ngo.orgName,
      metricCode: claim.metricCode,
      metricName: claim.metric.name,
      unit: claim.unit,
      aggregatable: claim.metric.aggregatable,
      status: claim.status,
      value: claim.value.toString(),
      submittedAt: claim.submittedAt,
      triage,
    };
  });

  const portfolio = summarisePortfolio(rows);
  const hygiene = registryHygiene(metrics, new Set(rows.map((r) => r.metricCode)));
  const incidents = incidentsFromIndex(approvedIndex);

  const queueAge = oldestSubmitted?.submittedAt ? daysSince(oldestSubmitted.submittedAt) : null;
  const queueSla = queueAge === null ? null : slaState("Impact Review", queueAge);
  const target = slaTargetFor("Impact Review");
  const truncated = assertedTotal > claims.length;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Impact quality</h1>
        </div>
        <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          How much of what this platform reports is actually backed by evidence. Every figure below
          is a defect count, not an achievement — the question is whether the numbers we publish can
          be substantiated, not how large they are.
        </p>
        <p className="max-w-3xl text-xs text-gray-500 dark:text-gray-500">
          Looking for whether donor updates were delivered and opened? That is{" "}
          <Link href="/admin/impact-health" className="underline">
            impact health
          </Link>
          , a different question despite the similar name.
          {truncated &&
            ` · Computed over the ${claims.length} most recent of ${assertedTotal} asserted claims.`}
        </p>
      </header>

      {portfolio.assertedCount === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
          <Sigma className="mx-auto h-6 w-6 text-gray-400" />
          <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
            No organisation has reported a number yet.
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Once a claim is submitted against a governed metric it appears in{" "}
            <Link href="/admin/impact-review" className="underline">
              impact review
            </Link>
            , and its backing is measured here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Evidence-backed share"
              value={sharePercent(portfolio.backedShare)}
              tone={shareTone(portfolio.backedShare)}
              hint={`${portfolio.backedCount} of ${portfolio.assertedCount} asserted numbers are approved and still supported`}
            />
            <Stat
              label="Cannot be approved"
              value={String(portfolio.blockedCount)}
              tone={portfolio.blockedCount > 0 ? "text-red-600 dark:text-red-400" : undefined}
              hint="A blocking finding stands in the way"
            />
            <Stat
              label="Need judgement"
              value={String(portfolio.needsReviewCount)}
              tone={portfolio.needsReviewCount > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
              hint="Serious or open questions, approvable with an override"
            />
            <Stat
              label="Oldest waiting"
              value={queueAge === null ? "—" : `${queueAge}d`}
              tone={
                queueSla === "breached"
                  ? "text-red-600 dark:text-red-400"
                  : queueSla === "at_risk"
                    ? "text-amber-600 dark:text-amber-400"
                    : undefined
              }
              hint={
                queueAge === null
                  ? "Nothing is waiting on a decision"
                  : `${slaLabel("Impact Review", queueAge)} · ${target?.days}-day target`
              }
            />
          </div>

          {/* The loudest panel on the page, and the one that justifies re-triaging
              approved claims instead of trusting the approval. */}
          {portfolio.retractionCandidates.length > 0 && (
            <section className="rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
                <h2 className="text-sm font-bold text-red-900 dark:text-red-300">
                  Approved, but the evidence no longer holds
                </h2>
              </div>
              <p className="mt-1 max-w-3xl text-xs text-red-800 dark:text-red-300/80">
                These numbers were backed when a human approved them and are not any more —
                consent withdrawn, or cited evidence no longer approved. They are already published
                figures, so each needs withdrawing and superseding rather than editing.
              </p>
              <ul className="mt-3 space-y-2">
                {portfolio.retractionCandidates.map((c) => (
                  <li key={c.claimId} className="text-sm text-red-900 dark:text-red-200">
                    <span className="font-semibold">{c.value}</span> on{" "}
                    <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold dark:bg-red-900/40">
                      {c.metricCode}
                    </code>{" "}
                    — {c.orgName} · {c.findingCodes.join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Panel
            icon={Copy}
            title="Double-counting incidents"
            subtitle="The same evidence counted by more than one approved claim on the same metric. Each one is a human override of a finding the platform raised — double counting is a HIGH finding, not a block, because one capture can legitimately document two distributions."
          >
            {incidents.length === 0 ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                No evidence is counted twice on the same metric.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      <th className={TH}>Metric</th>
                      <th className={TH}>Evidence</th>
                      <th className={TH}>Counted by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.map((i) => (
                      <tr
                        key={`${i.metricCode}-${i.evidenceRef}`}
                        className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
                      >
                        <td className={TD}>
                          <code className="font-mono text-[11px]">{i.metricCode}</code>
                        </td>
                        <td className={TD}>
                          <code className="font-mono text-[11px] text-gray-600 dark:text-gray-400">
                            {i.evidenceRef}
                          </code>
                        </td>
                        <td className={TD}>
                          <span className="font-semibold">{i.claimIds.length} claims</span>
                          <span className="ml-2 font-mono text-[11px] text-gray-500 dark:text-gray-500">
                            {i.claimIds.join(", ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            icon={Sigma}
            title="Backing by metric"
            subtitle="Value shares are reported per metric, where the unit is constant and a sum means something. There is deliberately no portfolio-wide value total: adding meals served to people trained produces a figure in no unit, and the larger metric would swamp it."
          >
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className={TH}>Metric</th>
                    <th className={TH}>Claims backed</th>
                    <th className={TH}>Value backed</th>
                    <th className={TH}>Backed share</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.byMetric.map((m) => (
                    <tr
                      key={m.metricCode}
                      className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
                    >
                      <td className={TD}>
                        <code className="font-mono text-[11px] font-semibold">{m.metricCode}</code>
                        <p className="text-xs text-gray-500 dark:text-gray-500">{m.metricName}</p>
                      </td>
                      <td className={TD}>
                        {m.backedCount} / {m.assertedCount}
                      </td>
                      <td className={TD}>
                        {m.aggregatable ? (
                          <>
                            {m.backedValue} / {m.assertedValue}
                            <span className="ml-1 text-xs text-gray-500 dark:text-gray-500">
                              {UNIT_LABELS[m.unit]}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-gray-500 dark:text-gray-500">
                            not summable
                          </span>
                        )}
                      </td>
                      <td className={`${TD} font-semibold ${shareTone(m.countShare)}`}>
                        {sharePercent(m.countShare)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {portfolio.nonAggregatableExcluded > 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
                {portfolio.nonAggregatableExcluded} claim
                {portfolio.nonAggregatableExcluded === 1 ? "" : "s"} sit on metrics the registry
                marks not summable (a percentage or a rate), so they carry a claim share but no
                value total.
              </p>
            )}
          </Panel>

          <Panel
            icon={AlertTriangle}
            title="Unsupported claims by organisation"
            subtitle="Claims carrying a blocking or serious finding, as a share of what the organisation currently asserts. The denominator is printed beside every rate on purpose: one defect out of one is not a worse record than eight out of ten, and this list is a prompt to look, not a finding against anybody."
          >
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800">
                    <th className={TH}>Organisation</th>
                    <th className={TH}>With findings</th>
                    <th className={TH}>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.byOrg.map((o) => (
                    <tr
                      key={o.ngoId}
                      className="border-b border-gray-100 last:border-0 dark:border-gray-800/60"
                    >
                      <td className={TD}>{o.orgName}</td>
                      <td className={TD}>
                        {o.defectiveCount} of {o.assertedCount}
                      </td>
                      <td
                        className={`${TD} font-semibold ${
                          o.rate > 0.5
                            ? "text-red-600 dark:text-red-400"
                            : o.rate > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {sharePercent(o.rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      <Panel
        icon={Layers}
        title="Registry hygiene"
        subtitle="Whether the metric registry itself is in good order. Shown even when every line is empty, because one of these counts must be zero by construction and a dashboard is the only place a regression in it would ever be noticed."
      >
        <dl className="space-y-3">
          <div>
            <dt className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              Active metrics with no evidence rule
            </dt>
            <dd className="mt-0.5 text-sm">
              {hygiene.activeWithoutEvidenceRule.length === 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  None, as required. A metric with no evidence rule could never fail an evidence
                  check, so the registry refuses to activate one.
                </span>
              ) : (
                <span className="font-semibold text-red-600 dark:text-red-400">
                  {hygiene.activeWithoutEvidenceRule.join(", ")} — this must be impossible. The
                  guard in lib/metric-registry.ts has regressed.
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              Draft or deprecated metrics being claimed against
            </dt>
            <dd className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
              {hygiene.closedBeingClaimed.length === 0
                ? "None."
                : hygiene.closedBeingClaimed.join(", ")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              Active metrics never claimed against
            </dt>
            <dd className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
              {hygiene.activeNeverClaimed.length === 0 ? (
                "None — every published metric is in use."
              ) : (
                <>
                  {hygiene.activeNeverClaimed.join(", ")}
                  <span className="ml-1 text-xs text-gray-500 dark:text-gray-500">
                    (published but unused — not a defect, just a contract nobody took up)
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel
        icon={Timer}
        title="Queue age"
        subtitle={target?.rationale ?? "No target declared for this queue."}
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {queueAge === null ? (
            "Nothing is waiting on an impact-review decision."
          ) : (
            <>
              The oldest submitted claim has been waiting{" "}
              <span className="font-semibold">{queueAge} days</span>
              {oldestSubmitted?.submittedAt && ` (since ${fmtDate(oldestSubmitted.submittedAt)})`} —{" "}
              {slaLabel("Impact Review", queueAge)}.
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
          Detection and visibility only. Nothing here escalates automatically and no breach
          notification is sent — a breach is surfaced to a human who is already looking, not pushed
          to one who is not. Same honesty note as{" "}
          <Link href="/admin/sla" className="underline">
            /admin/sla
          </Link>
          .
        </p>
      </Panel>
    </div>
  );
}
