import prisma from "@/lib/prisma";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { describeFaultInjection } from "@/lib/ai/fault-injection";
import FaultInjectionToggle from "./FaultInjectionToggle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI telemetry (AI-009) and the fault-injection switch (AI-010). Every model
 * call made through lib/ai/telemetry.ts — and every rule-based run that stood
 * in for one — with model, prompt version, latency, tokens, cost estimate and
 * outcome. Metadata only: no prompt or response text is stored.
 */
const OUTCOME_STYLE: Record<string, string> = {
  OK: "bg-emerald-50 text-emerald-700 border-emerald-100",
  ERROR: "bg-red-50 text-red-700 border-red-100",
  TIMEOUT: "bg-amber-50 text-amber-700 border-amber-100",
};

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export default async function AiTelemetryPage({ searchParams }: { searchParams: { site?: string; outcome?: string } }) {
  const site = searchParams.site?.trim() || undefined;
  const outcome = ["OK", "ERROR", "TIMEOUT"].includes(searchParams.outcome ?? "") ? searchParams.outcome : undefined;

  let runs, recent, fault;
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600_000);
    [runs, recent, fault] = await Promise.all([
      prisma.aiCallLog.findMany({
        where: { ...(site ? { site } : {}), ...(outcome ? { outcome } : {}) },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.aiCallLog.findMany({
        where: { createdAt: { gte: since } },
        select: { site: true, provider: true, outcome: true, latencyMs: true, tokensIn: true, tokensOut: true, costUsd: true, faultInjected: true },
        take: 5000,
      }),
      describeFaultInjection(),
    ]);
  } catch (err: any) {
    return <SchemaOutOfSync title="AI telemetry failed to load" detail={err?.message ?? String(err)} />;
  }

  const bySite = new Map<string, typeof recent>();
  for (const r of recent) {
    const key = `${r.site}|${r.provider}`;
    bySite.set(key, [...(bySite.get(key) ?? []), r]);
  }
  const summary = Array.from(bySite.entries())
    .map(([key, rows]) => {
      const [s, provider] = key.split("|");
      const ok = rows.filter((r) => r.outcome === "OK");
      return {
        site: s,
        provider,
        calls: rows.length,
        failures: rows.length - ok.length,
        injected: rows.filter((r) => r.faultInjected).length,
        p50: percentile(ok.map((r) => r.latencyMs), 50),
        p95: percentile(ok.map((r) => r.latencyMs), 95),
        tokens: rows.reduce((n, r) => n + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0),
        cost: rows.reduce((n, r) => n + (r.costUsd ? Number(r.costUsd) : 0), 0),
      };
    })
    .sort((a, b) => b.calls - a.calls);

  return (
    <div className="py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">AI telemetry</h1>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          Every model call and every rule-based stand-in: provider, model, prompt version, latency, tokens (when the
          provider reports them), an estimated cost and the outcome. A failed call leaves its caller in an explicit
          &ldquo;AI unavailable — human review required&rdquo; state. No prompt or response text is stored.
        </p>

        <FaultInjectionToggle initial={fault} />

        <h2 className="mt-8 text-lg font-bold text-gray-900">Last 7 days by call site</h2>
        {summary.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No AI calls recorded in the last 7 days.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2 text-right">Injected</th>
                  <th className="px-3 py-2 text-right">p50 / p95 ms</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">Est. cost (USD)</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={`${r.site}-${r.provider}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs text-gray-900">{r.site}</td>
                    <td className="px-3 py-2 text-gray-600">{r.provider}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className={`px-3 py-2 text-right ${r.failures ? "text-red-600 font-semibold" : ""}`}>{r.failures}</td>
                    <td className="px-3 py-2 text-right">{r.injected}</td>
                    <td className="px-3 py-2 text-right">{r.p50 ?? "—"} / {r.p95 ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{r.tokens || "—"}</td>
                    <td className="px-3 py-2 text-right">{r.cost ? r.cost.toFixed(4) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">Recent runs</h2>
          <form method="GET" className="flex flex-wrap gap-2">
            <input name="site" defaultValue={site} placeholder="Site (e.g. screen-project)" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
            <select name="outcome" defaultValue={outcome ?? ""} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <option value="">All outcomes</option>
              <option value="OK">OK</option>
              <option value="ERROR">ERROR</option>
              <option value="TIMEOUT">TIMEOUT</option>
            </select>
            <button type="submit" className="rounded-lg bg-trust-600 px-4 py-2 text-sm font-semibold text-white hover:bg-trust-700">Filter</button>
          </form>
        </div>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No runs match.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">When (UTC)</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Provider / model</th>
                  <th className="px-3 py-2">Prompt</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2 text-right">Latency ms</th>
                  <th className="px-3 py-2 text-right">Tokens in / out</th>
                  <th className="px-3 py-2 text-right">Est. cost</th>
                  <th className="px-3 py-2">Error / note</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-900">{r.site}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{r.provider} / {r.model}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.promptVersion}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${OUTCOME_STYLE[r.outcome] ?? ""}`}>{r.outcome}</span>
                      {r.faultInjected && <span className="ml-1 text-xs text-amber-600">injected</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{r.latencyMs}</td>
                    <td className="px-3 py-2 text-right">{r.tokensIn ?? "—"} / {r.tokensOut ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{r.costUsd ? `$${Number(r.costUsd).toFixed(5)}` : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.errorCode ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
