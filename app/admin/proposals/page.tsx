import SupersededTrackNotice from "@/app/admin/components/SupersededTrackNotice";
import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoSubmitSelect from "@/app/admin/components/AutoSubmitSelect";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { formatCompactINR } from "@/lib/format-currency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The proposal review queue.
 *
 * What a shortlisted organisation actually proposes to do with the money —
 * the step that was missing between matching and funding. Defaults to the
 * proposals waiting on a decision, because that is what an admin opens this
 * page to do.
 */

const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN", "DRAFT"] as const;

const STATUS_STYLE: Record<string, string> = {
  SUBMITTED: "bg-amber-50 text-amber-700 border-amber-100",
  UNDER_REVIEW: "bg-blue-50 text-blue-700 border-blue-100",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  REJECTED: "bg-red-50 text-red-700 border-red-100",
  WITHDRAWN: "bg-gray-100 text-gray-600 border-gray-200",
  DRAFT: "bg-gray-100 text-gray-600 border-gray-200",
};

export default async function AdminProposalsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";

  const where: any = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" as const } },
      { ngo: { orgName: { contains: q, mode: "insensitive" as const } } },
      { opportunity: { title: { contains: q, mode: "insensitive" as const } } },
    ];
  }

  let proposals;
  try {
    proposals = await prisma.proposal.findMany({
      where,
      orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        title: true,
        status: true,
        requestedAmount: true,
        submittedAt: true,
        createdAt: true,
        ngo: { select: { orgName: true } },
        opportunity: { select: { title: true, funderName: true } },
      },
    });
  } catch (err: any) {
    return <SchemaOutOfSync title="Proposals failed to load" detail={err?.message ?? String(err)} />;
  }

  const waiting = proposals.filter((p) => p.status === "SUBMITTED" || p.status === "UNDER_REVIEW").length;

  return (
    <div className="py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SupersededTrackNotice page="proposals" />
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">Proposals</h1>
        <p className="mt-1 text-sm text-gray-500 max-w-2xl">
          What shortlisted organisations propose to do with the funding. A proposal can only be
          submitted by an organisation this opportunity was actually shortlisted for.
        </p>

        <form className="mt-6 flex flex-wrap gap-3" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search proposal, organisation or opportunity…"
            className="flex-1 min-w-[260px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-trust-500"
          />
          <AutoSubmitSelect
            name="status"
            defaultValue={status}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </AutoSubmitSelect>
          <button
            type="submit"
            className="rounded-lg bg-trust-600 px-4 py-2 text-sm font-semibold text-white hover:bg-trust-700"
          >
            Search
          </button>
        </form>

        <p className="mt-4 text-xs text-gray-500">
          {proposals.length} shown · {waiting} awaiting a decision
        </p>

        <div className="mt-3 space-y-2">
          {proposals.map((p) => (
            <Link
              key={p.id}
              href={`/admin/proposals/${p.id}`}
              className="block rounded-xl border border-gray-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-emerald-200 transition"
            >
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLE[p.status]}`}
                    >
                      {p.status.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      {p.ngo.orgName}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-bold text-gray-900">{p.title}</p>
                  <p className="text-xs text-gray-500">
                    for {p.opportunity.title} · {p.opportunity.funderName}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-900">
                    {formatCompactINR(Number(p.requestedAmount))}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {p.submittedAt
                      ? `submitted ${p.submittedAt.toLocaleDateString("en-IN")}`
                      : "not submitted"}
                  </p>
                </div>
              </div>
            </Link>
          ))}

          {proposals.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <p className="text-sm font-medium text-gray-500">
                No proposals match this view.
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Proposals appear once a shortlisted organisation submits one.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
