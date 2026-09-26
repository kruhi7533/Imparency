import Link from "next/link";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getActor } from "@/lib/requirements/access";
import { listRequirementsForActor } from "@/lib/requirements/queries";
import { StatusBadge } from "@/components/requirements/StatusBadge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABS = [
  { key: "PENDING_ADMIN_REVIEW", label: "Pending Review" },
  { key: "NEEDS_CORRECTION", label: "Needs Correction" },
  { key: "VALIDATED", label: "Validated" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
];
const POST_VALIDATION = ["VALIDATED", "MATCHING", "SHORTLISTED", "NGO_RESPONSE", "SELECTED", "CONTRACTED"];

/** Admin CSR requirements queue — the governance gate before matching. */
export default async function AdminRequirementsPage({ searchParams }: { searchParams: { status?: string } }) {
  const actor = await getActor();
  if (!actor || actor.role !== "ADMIN") redirect("/unauthorized");

  const tab = TABS.some((t) => t.key === searchParams.status) ? searchParams.status! : "PENDING_ADMIN_REVIEW";
  const [all, grouped] = await Promise.all([
    listRequirementsForActor(actor),
    prisma.sponsorRequirement.groupBy({ by: ["status"], _count: true }),
  ]);
  const countOf = (statuses: string[]) => grouped.filter((g) => statuses.includes(g.status)).reduce((s, g) => s + g._count, 0);
  const counts: Record<string, number> = {
    PENDING_ADMIN_REVIEW: countOf(["PENDING_ADMIN_REVIEW"]),
    NEEDS_CORRECTION: countOf(["NEEDS_CORRECTION"]),
    VALIDATED: countOf(POST_VALIDATION),
    REJECTED: countOf(["REJECTED"]),
    ALL: all.length,
  };
  const rows =
    tab === "ALL" ? all : tab === "VALIDATED" ? all.filter((r) => POST_VALIDATION.includes(r.status)) : all.filter((r) => r.status === tab);
  if (tab === "PENDING_ADMIN_REVIEW") rows.sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">CSR Requirements</h1>
          <p className="text-sm text-gray-500 mt-1">
            Verify AI-extracted donor requirements. Only requirements you approve can enter NGO matching.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {TABS.slice(0, 4).map((t) => (
            <Link
              key={t.key}
              href={`/admin/requirements?status=${t.key}`}
              className={`rounded-2xl border p-4 transition ${tab === t.key ? "border-emerald-500/50 bg-emerald-500/5" : "border-gray-800 bg-gray-900/40 hover:border-gray-700"}`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{t.label}</p>
              <p className="text-2xl font-black text-white mt-1">{counts[t.key]}</p>
            </Link>
          ))}
        </div>

        <div className="flex gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/requirements?status=${t.key}`}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${tab === t.key ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-gray-800 text-gray-400"}`}
            >
              {t.label} ({counts[t.key]})
            </Link>
          ))}
        </div>

        <div className="border border-gray-800 bg-gray-900/40 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
              <tr>
                <th className="px-4 py-3">Donor</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3">Avg. confidence</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                    Nothing here.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-800/30">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-100">{r.sponsor?.companyName || r.sponsor?.name}</p>
                      <p className="text-xs text-gray-500">{r.sponsor?.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-100 break-all">{r.fileName}</p>
                      <p className="text-xs text-gray-500">{[r.sector, r.state].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-blue-300">v{r.version}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                    <td className="px-4 py-3 text-xs text-gray-300">{r.averageConfidence ? `${Math.round(r.averageConfidence * 100)}%` : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/requirements/${r.id}`} className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-bold hover:bg-emerald-500/25">
                        {r.status === "PENDING_ADMIN_REVIEW" ? "Review" : "View"}
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
