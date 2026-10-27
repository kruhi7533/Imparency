import prisma from "@/lib/prisma";
import Link from "next/link";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import DeadLetterActions from "./DeadLetterActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator dead-letter queue (ADM-018 / NEG-012): failed job runs, impact
 * deliveries that exhausted their retries, and failed donor notifications.
 * Inspect, replay once, or dismiss. Every replay/dismissal is audited.
 */
const STATUS_TABS = ["OPEN", "REPLAY_FAILED", "REPLAYED", "DISMISSED", "ALL"] as const;
const KIND_LABEL: Record<string, string> = {
  JOB_RUN: "Job run",
  IMPACT_DELIVERY: "Impact delivery",
  NOTIFICATION_DELIVERY: "Donor notification",
};

export default async function DeadLettersPage({ searchParams }: { searchParams: { status?: string } }) {
  const status = (STATUS_TABS as readonly string[]).includes(searchParams.status ?? "") ? searchParams.status! : "OPEN";
  let items, counts;
  try {
    [items, counts] = await Promise.all([
      prisma.deadLetter.findMany({
        where: status === "ALL" ? {} : { status },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.deadLetter.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
  } catch (err: any) {
    return <SchemaOutOfSync title="Dead-letter queue failed to load" detail={err?.message ?? String(err)} />;
  }
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <div className="py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">Dead-letter queue</h1>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          Work that failed for good: scheduled job runs that threw, impact updates that ran out of retries, and donor
          notifications a channel could not deliver. Each can be replayed once (a second replay is refused) or dismissed.
          Payloads are ids only.
        </p>

        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Status">
          {STATUS_TABS.map((s) => (
            <Link
              key={s}
              href={`/admin/dead-letters?status=${s}`}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                s === status
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {s.replace("_", " ")}
              {s !== "ALL" && <span className="ml-1 opacity-75">{countOf(s)}</span>}
            </Link>
          ))}
        </nav>

        {items.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
            Nothing here. {status === "OPEN" ? "No failed work is waiting for an operator." : ""}
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map((d) => (
              <li key={d.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">{KIND_LABEL[d.kind] ?? d.kind}</span>
                      <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">{d.status}</span>
                      <span className="text-xs text-gray-500">{d.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC</span>
                      <span className="text-xs text-gray-500">attempts: {d.attempts}</span>
                    </div>
                    <p className="mt-1 break-words text-xs text-red-700">{d.errorMessage ?? "No error recorded."}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-gray-500">
                      {Object.entries((d.refs as Record<string, unknown>) ?? {})
                        .map(([k, v]) => `${k}=${v}`)
                        .join("  ")}
                    </p>
                    {d.replayResult && (
                      <p className="mt-1 break-all font-mono text-[11px] text-gray-600">replay: {JSON.stringify(d.replayResult)}</p>
                    )}
                  </div>
                  <DeadLetterActions id={d.id} status={d.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
