import prisma from "@/lib/prisma";
import Link from "next/link";
import AutoSubmitSelect from "@/app/admin/components/AutoSubmitSelect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The NGO catalogue — every organisation on the platform, searchable.
 *
 * Until this page existed an NGO could only be reached two ways: by knowing its
 * id (/admin/ngos/[id]) or by catching it in the verification queue while it
 * was still PENDING. Once approved, an organisation effectively disappeared
 * from the console. Admin could not answer "show me every suspended NGO" or
 * "find the trust whose name starts with Asha" at all.
 *
 * Server-rendered GET form, matching /admin/donors — no client state, the URL
 * is the query, and a filtered view is a shareable link.
 *
 * PRIVACY: search deliberately covers orgName and registrationNumber only, and
 * NOT panNumber. Search terms land in the URL query string, and this project's
 * rule is that personal data never goes there. (/admin/donors does search PAN
 * that way — that is a pre-existing violation, not a precedent to copy.)
 */

const STATUS_BADGE: Record<string, string> = {
  VERIFIED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
};

function healthTone(score: number | null): string {
  if (score === null) return "text-gray-400 dark:text-gray-500";
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export default async function AdminNgosPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; flag?: string };
}) {
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";
  const flag = searchParams.flag || "";

  const ngos = await prisma.nGOProfile.findMany({
    where: {
      isDeleted: false,
      ...(q
        ? {
            OR: [
              { orgName: { contains: q, mode: "insensitive" } },
              { registrationNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status ? { verificationStatus: status as any } : {}),
      ...(flag === "suspended" ? { isSuspended: true } : {}),
      ...(flag === "reverification" ? { reverificationRequiredAt: { not: null } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      orgName: true,
      registrationNumber: true,
      verificationStatus: true,
      isSuspended: true,
      healthScore: true,
      reverificationRequiredAt: true,
      createdAt: true,
      compliance: { select: { fcraStatus: true } },
      _count: { select: { projects: true } },
    },
  });

  // Open alerts per NGO, so the catalogue shows which orgs need attention
  // rather than making an admin open each one to find out.
  const ngoIds = ngos.map((n) => n.id);
  const alerts = ngoIds.length
    ? await prisma.fraudAlert.groupBy({
        by: ["entityId"],
        where: { entityType: "NGO", entityId: { in: ngoIds }, resolved: false },
        _count: true,
      })
    : [];
  const alertMap = new Map(alerts.map((a) => [a.entityId, a._count]));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Organisations</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {ngos.length} organisation{ngos.length === 1 ? "" : "s"} shown (newest first, max 100).
          Search by name or registration number.
        </p>

        {/* GET form — server-rendered, so the URL is the query and a filtered
            view can be pasted to a colleague. */}
        <form className="mt-6 flex flex-wrap gap-3" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search organisation name or registration number…"
            className="flex-1 min-w-[240px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <AutoSubmitSelect
            name="status"
            defaultValue={status}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="VERIFIED">Verified</option>
            <option value="REJECTED">Rejected</option>
          </AutoSubmitSelect>
          <AutoSubmitSelect
            name="flag"
            defaultValue={flag}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="">Any state</option>
            <option value="suspended">Suspended only</option>
            <option value="reverification">Re-verification due</option>
          </AutoSubmitSelect>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Search
          </button>
          {(q || status || flag) && (
            <Link
              href="/admin/ngos"
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
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Organisation</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Health</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">FCRA</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Projects</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Needs attention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {ngos.map((ngo) => {
                const openAlerts = alertMap.get(ngo.id) ?? 0;
                const score = ngo.healthScore === null ? null : Number(ngo.healthScore);
                return (
                  <tr key={ngo.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/ngos/${ngo.id}`}
                        className="text-sm font-bold text-gray-900 dark:text-white hover:text-emerald-600 hover:underline"
                      >
                        {ngo.orgName}
                      </Link>
                      <div className="text-xs text-gray-400 dark:text-gray-500">{ngo.registrationNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[ngo.verificationStatus] ?? ""}`}>
                        {ngo.verificationStatus}
                      </span>
                      {ngo.isSuspended && (
                        <span className="ml-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-400">
                          Suspended
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-sm font-semibold ${healthTone(score)}`}>
                      {/* "—" not "0": no score is not a bad score. */}
                      {score === null ? "—" : score.toFixed(0)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {ngo.compliance?.fcraStatus ?? "NONE"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{ngo._count.projects}</td>
                    <td className="px-4 py-3 text-xs">
                      {openAlerts > 0 && (
                        <span className="mr-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-400">
                          {openAlerts} alert{openAlerts === 1 ? "" : "s"}
                        </span>
                      )}
                      {ngo.reverificationRequiredAt && (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                          Re-verification due
                        </span>
                      )}
                      {openAlerts === 0 && !ngo.reverificationRequiredAt && (
                        <span className="text-gray-400 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {ngos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    No organisations match this search.
                    {(q || status || flag) && (
                      <>
                        {" "}
                        <Link href="/admin/ngos" className="text-emerald-600 hover:underline">
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
