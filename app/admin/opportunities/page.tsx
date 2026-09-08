import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoSubmitSelect from "@/app/admin/components/AutoSubmitSelect";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import NewOpportunityForm from "./NewOpportunityForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The funding-opportunity catalogue.
 *
 * Server-rendered GET form, matching /admin/ngos — the URL is the query, so a
 * filtered view is a shareable link rather than a search someone has to redo.
 */

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  CLOSED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const JOB_BADGE: Record<string, string> = {
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  RUNNING: "text-amber-600 dark:text-amber-400",
  QUEUED: "text-amber-600 dark:text-amber-400",
  FAILED: "text-red-600 dark:text-red-400",
};

export default async function AdminOpportunitiesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";

  let opportunities;
  try {
    opportunities = await prisma.fundingOpportunity.findMany({
      where: {
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { funderName: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        funderName: true,
        status: true,
        createdAt: true,
        _count: { select: { criteria: true } },
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            finishedAt: true,
            eligibleCount: true,
            ineligibleCount: true,
            unknownCount: true,
          },
        },
      },
    });
  } catch (err: any) {
    // These tables arrive in a fresh migration, so a stale Prisma client or an
    // un-migrated database is the likeliest first-run failure here.
    return <SchemaOutOfSync title="Opportunities failed to load" detail={err?.message ?? String(err)} />;
  }

  // Accounts that can be named as the funder behind an opportunity. A funder is
  // a DONOR with an institutional persona — there is no funder role, and no
  // funder organisation, so this is one contact rather than a team.
  const funderAccounts = await prisma.user.findMany({
    where: {
      role: "DONOR",
      donorPersona: { in: ["CSR_OFFICER", "FOUNDATION", "GOVERNMENT"] },
    },
    select: { id: true, name: true, email: true, companyName: true, donorPersona: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Opportunities</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {opportunities.length} opportunit{opportunities.length === 1 ? "y" : "ies"} shown (newest
          first, max 100). Matching is a gate, not a ranking — a run says who qualifies and why, and
          nothing is shortlisted until you say so.
        </p>

        <form className="mt-6 flex flex-wrap gap-3" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search title or funder…"
            className="flex-1 min-w-[240px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <AutoSubmitSelect
            name="status"
            defaultValue={status}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </AutoSubmitSelect>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Search
          </button>
          {(q || status) && (
            <Link
              href="/admin/opportunities"
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-gray-950/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Opportunity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Criteria</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Last run</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {opportunities.map((o) => {
                const job = o.jobs[0];
                return (
                  <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/opportunities/${o.id}`}
                        className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                      >
                        {o.title}
                      </Link>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{o.funderName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[o.status] ?? ""}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                      {o._count.criteria}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {job ? (
                        <Link
                          href={`/admin/opportunities/${o.id}/jobs/${job.id}`}
                          className={`font-semibold hover:underline ${JOB_BADGE[job.status] ?? ""}`}
                        >
                          {job.status}
                        </Link>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600">Never run</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 tabular-nums">
                      {job && job.status === "COMPLETED" ? (
                        <>
                          {job.eligibleCount} eligible · {job.ineligibleCount} not · {job.unknownCount} unknown
                        </>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {opportunities.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    No opportunities match this view.{" "}
                    <Link href="/admin/opportunities" className="text-emerald-600 hover:underline">
                      Clear filters
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <NewOpportunityForm funderAccounts={funderAccounts} />
      </div>
    </div>
  );
}
