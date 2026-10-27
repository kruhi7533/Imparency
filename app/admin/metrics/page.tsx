import prisma from "@/lib/prisma";
import { Ruler, ShieldCheck, TriangleAlert, FileWarning, Inbox } from "lucide-react";
import {
  UNIT_LABELS,
  EVIDENCE_KIND_LABELS,
  UNBACKED_EVIDENCE_KINDS,
} from "@/lib/metric-registry";
import { SDG_MASTER, IRIS_MASTER } from "@/lib/impact-metrics";
import MetricStatusActions from "./MetricStatusActions";

/**
 * /admin/metrics — the Metric Registry.
 *
 * The governance surface for Week 8: every metric the platform will accept a
 * number against, what counts as one, and what evidence can prove it.
 *
 * The hygiene panel at the top is the point. A registry is only worth having
 * if someone notices when it rots — an ACTIVE metric with no evidence rule, a
 * metric requiring evidence no table can produce, a metric nobody has ever
 * claimed. Those are listed as findings rather than left for whoever trips
 * over them, the same reasoning as the "Not analysed" state in NGO
 * verification: a gap must look like a gap.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE:
    "bg-emerald-50 text-emerald-700 ring-emerald-200",
  DRAFT:
    "bg-amber-50 text-amber-700 ring-amber-200",
  DEPRECATED:
    "bg-gray-100 text-gray-600 ring-gray-200",
};

export default async function MetricRegistryPage() {
  const metrics = await prisma.metricDefinition.findMany({
    orderBy: [{ status: "asc" }, { code: "asc" }],
    include: { _count: { select: { claims: true } } },
  });

  // --- registry hygiene ----------------------------------------------------
  // Must be empty by construction: validateMetricDefinition refuses to
  // activate a metric with no evidence rule. Shown anyway, so a regression in
  // that rule is visible here instead of silently letting claims through.
  const activeWithoutEvidenceRule = metrics.filter(
    (m) => m.status === "ACTIVE" && m.requiredEvidence.length === 0
  );
  const unprovable = metrics.filter(
    (m) =>
      m.status === "ACTIVE" &&
      m.requiredEvidence.length > 0 &&
      m.requiredEvidence.every((k) => UNBACKED_EVIDENCE_KINDS.includes(k))
  );
  const draftsBeingClaimed = metrics.filter((m) => m.status !== "ACTIVE" && m._count.claims > 0);
  const neverClaimed = metrics.filter((m) => m.status === "ACTIVE" && m._count.claims === 0);

  const activeCount = metrics.filter((m) => m.status === "ACTIVE").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Ruler className="h-5 w-5 text-indigo-600" />
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">Metric registry</h1>
        </div>
        <p className="max-w-3xl text-sm text-gray-600">
          The governed definition of every metric this platform will accept a number against. A
          number reaches a donor report only if an approved claim cites approved evidence for it —
          so a metric with no evidence rule cannot be activated, and a claim against a draft or
          deprecated metric is refused.
        </p>
        <p className="max-w-3xl text-xs text-gray-500">
          {activeCount} active {activeCount === 1 ? "metric" : "metrics"} of {metrics.length}.
          Codes are a published contract — the NGO portal files claims against them, so renaming
          one is deliberately not possible. Deprecate instead; existing approved claims are
          unaffected.
        </p>
      </header>

      {/* --- hygiene ------------------------------------------------------- */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <ShieldCheck className="h-4 w-4" />
          Registry health
        </h2>
        <div className="space-y-2 text-sm">
          {activeWithoutEvidenceRule.length > 0 && (
            <Finding tone="bad" icon={TriangleAlert}>
              <strong>{activeWithoutEvidenceRule.length} active metric(s) have no required
              evidence</strong> ({activeWithoutEvidenceRule.map((m) => m.code).join(", ")}). Claims
              against them cannot fail an evidence check, so they would pass having proved nothing.
              This should be impossible — it means the activation rule regressed.
            </Finding>
          )}
          {unprovable.length > 0 && (
            <Finding tone="warn" icon={FileWarning}>
              <strong>{unprovable.length} active metric(s) require evidence no table produces
              yet</strong> ({unprovable.map((m) => m.code).join(", ")}). Every claim against them
              will be blocked until that evidence type exists. That is the correct refusal, not a
              bug — but the metric is unusable meanwhile.
            </Finding>
          )}
          {draftsBeingClaimed.length > 0 && (
            <Finding tone="warn" icon={TriangleAlert}>
              <strong>{draftsBeingClaimed.length} non-active metric(s) already have claims</strong>{" "}
              ({draftsBeingClaimed.map((m) => `${m.code} (${m._count.claims})`).join(", ")}).
              Existing claims keep their metric; no new ones can be filed.
            </Finding>
          )}
          {neverClaimed.length > 0 && (
            <Finding tone="neutral" icon={Inbox}>
              {neverClaimed.length} active metric(s) have never been claimed against (
              {neverClaimed.map((m) => m.code).join(", ")}). Not a problem — just unused so far.
            </Finding>
          )}
          {activeWithoutEvidenceRule.length === 0 &&
            unprovable.length === 0 &&
            draftsBeingClaimed.length === 0 &&
            neverClaimed.length === 0 && (
              <Finding tone="good" icon={ShieldCheck}>
                Every active metric has an evidence rule that the platform can actually satisfy,
                and all of them are in use.
              </Finding>
            )}
        </div>
      </section>

      {/* --- the registry -------------------------------------------------- */}
      {metrics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-gray-900">The registry is empty.</p>
          <p className="mt-1 text-sm text-gray-600">
            Seed the starter set with{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
              npx tsx -r dotenv/config tools/seed-metric-registry.ts -- --apply
            </code>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {metrics.map((m) => (
            <article
              key={m.code}
              className="rounded-xl border border-gray-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-900">
                      {m.code}
                    </code>
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${
                        STATUS_STYLES[m.status] ?? STATUS_STYLES.DEPRECATED
                      }`}
                    >
                      {m.status}
                    </span>
                    {m.version > 1 && (
                      <span className="text-[10px] font-semibold text-gray-500">
                        v{m.version}
                      </span>
                    )}
                    {!m.aggregatable && (
                      <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600 ring-1 ring-gray-200">
                        not summable
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1.5 font-semibold text-gray-900">
                    {m.name}{" "}
                    <span className="font-normal text-gray-500">
                      · in {UNIT_LABELS[m.unit]}
                    </span>
                  </h3>
                </div>
                <MetricStatusActions code={m.code} status={m.status} claimCount={m._count.claims} />
              </div>

              <p className="mt-2 max-w-3xl text-sm text-gray-700">{m.definition}</p>

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                <div>
                  <dt className="font-semibold text-gray-500">Evidence required</dt>
                  <dd className="mt-0.5 text-gray-900">
                    {m.requiredEvidence.length === 0 ? (
                      <span className="text-red-600">none — cannot be activated</span>
                    ) : (
                      m.requiredEvidence
                        .map(
                          (k) =>
                            EVIDENCE_KIND_LABELS[k] +
                            (UNBACKED_EVIDENCE_KINDS.includes(k) ? " (no source yet)" : "")
                        )
                        .join(" + ")
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-500">Claims</dt>
                  <dd className="mt-0.5 text-gray-900">{m._count.claims}</dd>
                </div>
                {m.sdgGoals.length > 0 && (
                  <div>
                    <dt className="font-semibold text-gray-500">SDG</dt>
                    <dd className="mt-0.5 text-gray-900">
                      {m.sdgGoals.map((g) => SDG_MASTER[g] ?? g).join(", ")}
                    </dd>
                  </div>
                )}
                {m.irisCode && (
                  <div>
                    <dt className="font-semibold text-gray-500">IRIS</dt>
                    <dd className="mt-0.5 text-gray-900">
                      {m.irisCode} · {IRIS_MASTER[m.irisCode] ?? "unmapped code"}
                    </dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Finding({
  tone,
  icon: Icon,
  children,
}: {
  tone: "good" | "warn" | "bad" | "neutral";
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const styles = {
    good: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-red-700",
    neutral: "text-gray-600",
  }[tone];
  return (
    <div className={`flex items-start gap-2 ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="leading-relaxed">{children}</p>
    </div>
  );
}
