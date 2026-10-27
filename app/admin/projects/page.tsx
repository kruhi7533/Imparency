import { matchingReadiness } from "@/lib/project-readiness";
import { loadProjectFunding } from "@/lib/project-funding";
import { ProjectFundingBadge } from "@/components/projects/ProjectFundingBadge";
import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoSubmitSelect from "@/app/admin/components/AutoSubmitSelect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The projects catalogue — every campaign on the platform, searchable, with
 * the NGO that runs it.
 *
 * Before this page existed a project was reachable only two ways: caught in
 * /admin/project-review while PENDING_APPROVAL, or found one-by-one on the
 * detail page of an NGO you already knew to look at. The moment a project
 * went ACTIVE it dropped out of every admin queue — the same blind spot the
 * NGO catalogue closed for organisations, now closed for their projects.
 *
 * Server-rendered GET form, matching /admin/donors and /admin/ngos — the URL
 * is the query, so a filtered view is a link an admin can hand to a
 * colleague rather than a search they have to redo.
 */

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-blue-100 text-blue-700",
  PAUSED: "bg-red-100 text-red-700",
};

function fundingPct(raised: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((raised / target) * 100));
}

export default async function AdminProjectsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";

  const projects = await prisma.project.findMany({
    where: {
      isDeleted: false,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { ngo: { orgName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(status ? { status: status as any } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      targetAmount: true,
      raisedAmount: true,
      createdAt: true,
      fundedAt: true,
      causeCategory: true,
      stateName: true,
      expectedBeneficiaries: true,
      beneficiaryGroup: true,
      durationMonths: true,
      ngo: { select: { id: true, orgName: true } },
      milestones: { select: { status: true } },
    },
  });
  const funding = await loadProjectFunding(projects.map((p) => p.id));

  return (
    <div className="py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">Projects</h1>
        <p className="mt-1 text-sm text-gray-500">
          {projects.length} project{projects.length === 1 ? "" : "s"} shown (newest first, max 100).
          Search by project title or organisation name.
        </p>

        <form className="mt-6 flex flex-wrap gap-3" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search project title or organisation…"
            className="flex-1 min-w-[240px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-trust-500"
          />
          <AutoSubmitSelect
            name="status"
            defaultValue={status}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="COMPLETED">Completed</option>
            <option value="PAUSED">Paused</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="DRAFT">Draft</option>
          </AutoSubmitSelect>
          <button
            type="submit"
            className="rounded-lg bg-trust-600 px-4 py-2 text-sm font-semibold text-white hover:bg-trust-700"
          >
            Search
          </button>
          {(q || status) && (
            <Link
              href="/admin/projects"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              Clear
            </Link>
          )}
        </form>

        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Project</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Organisation</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Funding</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Milestones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => {
                const raised = Number(p.raisedAmount);
                const target = Number(p.targetAmount);
                const pct = fundingPct(raised, target);
                const doneMilestones = p.milestones.filter((m) => ["COMPLETED", "VERIFIED"].includes(m.status)).length;
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {/* No admin-specific project detail page exists yet — links
                          to the real public page rather than a wrong or dead
                          route. /admin/initiatives/[id] looks similar but is a
                          different model entirely (ReliefInitiative, crisis
                          relief) and would silently 404 or show the wrong
                          record for a normal project id. */}
                      <Link
                        href={`/projects/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold text-gray-900 hover:text-emerald-600 hover:underline"
                      >
                        {p.title} ↗
                      </Link>
                      <div className="text-xs text-gray-500">
                        {new Date(p.createdAt).toLocaleDateString("en-IN")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/ngos/${p.ngo.id}`}
                        className="text-sm text-gray-700 hover:text-emerald-600 hover:underline"
                      >
                        {p.ngo.orgName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[p.status] ?? ""}`}>
                        {p.status.replace(/_/g, " ")}
                      </span>
                      <div className="mt-1">
                        <ProjectFundingBadge funding={funding.get(p.id)} fundedAt={p.fundedAt} />
                      </div>
                      {(() => {
                        const r = matchingReadiness(p);
                        return r.ready ? (
                          <p className="mt-1 text-[11px] text-emerald-600">Ready for matching</p>
                        ) : (
                          <p className="mt-1 text-[11px] text-amber-600" title={r.missing.join(", ")}>
                            Matching profile: {r.missing.length} missing
                          </p>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      ₹{raised.toLocaleString("en-IN")} / ₹{target.toLocaleString("en-IN")}
                      <div className="mt-1 h-1.5 w-24 rounded-full bg-gray-100">
                        <div
                          className="h-1.5 rounded-full bg-emerald-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {doneMilestones}/{p.milestones.length}
                    </td>
                  </tr>
                );
              })}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No projects match this search.
                    {(q || status) && (
                      <>
                        {" "}
                        <Link href="/admin/projects" className="text-emerald-600 hover:underline">
                          Clear filters
                        </Link>
                      </>
                    )}
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
