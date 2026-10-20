import Link from "next/link";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { loadPlatformTrail, parseTrailQuery, TRAIL_SOURCES, type TrailSource } from "@/lib/platform-trail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the platform recorded outside admin decisions — contracts and
 * payments, CSR requirements, NGO compliance, donor account events — in one
 * timeline (lib/platform-trail.ts). Admin decisions are in /admin/audit.
 * GET form, so a filtered view is a link an auditor can share.
 */
const LABEL: Record<TrailSource, string> = {
  contract: "Contracts & payments",
  requirement: "CSR requirements",
  compliance: "NGO compliance",
  donor: "Donor accounts",
};

export default async function PlatformTrailPage({
  searchParams,
}: {
  searchParams: { source?: string; from?: string; to?: string; action?: string };
}) {
  const q = parseTrailQuery(searchParams);
  let items;
  try {
    items = await loadPlatformTrail(q);
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Platform trail failed to load" detail={err?.meta?.table || err?.message} />;
    }
    throw err;
  }
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const input =
    "rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Platform trail</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
            What donors, NGOs and the platform recorded: contract and payment events, CSR requirement changes, NGO
            compliance and donor account events. Admin decisions are in the{" "}
            <Link href="/admin/audit" className="text-emerald-600 underline">
              audit trail
            </Link>
            . Donor account events show what happened, never the values (PAN, category).
          </p>
        </div>

        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-gray-500">
            Source
            <select name="source" defaultValue={q.sources.length === 1 ? q.sources[0] : ""} className={`${input} mt-1 block`}>
              <option value="">All sources</option>
              {TRAIL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-gray-500">
            Action contains
            <input name="action" defaultValue={q.action ?? ""} placeholder="e.g. PAYMENT" className={`${input} mt-1 block`} />
          </label>
          <label className="text-xs font-semibold text-gray-500">
            From
            <input type="date" name="from" defaultValue={day(q.from)} className={`${input} mt-1 block`} />
          </label>
          <label className="text-xs font-semibold text-gray-500">
            To
            <input type="date" name="to" defaultValue={day(q.to)} className={`${input} mt-1 block`} />
          </label>
          <button type="submit" className="min-h-[40px] rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
            Filter
          </button>
        </form>

        <p className="text-xs text-gray-500">
          {items.length} event{items.length === 1 ? "" : "s"}
          {items.length >= 300 ? " (showing the newest 300 — narrow the dates to see more)" : ""}
        </p>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800 text-sm">
            <thead>
              <tr>
                {["When", "Source", "Action", "By", "Detail"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((i, idx) => (
                <tr key={idx} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    <time dateTime={i.at.toISOString()}>{i.at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{LABEL[i.source]}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-white">
                    {i.href ? (
                      <Link href={i.href} className="hover:underline">
                        {i.action}
                      </Link>
                    ) : (
                      i.action
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300">
                    {i.actorRole}
                    {i.actorId ? <span className="block font-mono text-[10px] text-gray-400">{i.actorId}</span> : null}
                  </td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300 break-words max-w-md">{i.detail ?? "—"}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                    Nothing recorded in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
