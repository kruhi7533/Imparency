import prisma from "@/lib/prisma";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAN_BADGE: Record<string, string> = {
  VERIFIED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  UNVERIFIED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  PROVIDER_ERROR: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
};

export default async function AdminDonorsPage({
  searchParams,
}: {
  searchParams: { q?: string; pan?: string };
}) {
  const q = searchParams.q?.trim() || "";
  const panFilter = searchParams.pan || "";

  const donors = await prisma.user.findMany({
    where: {
      role: "DONOR",
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { panNumber: { contains: q.toUpperCase() } },
            ],
          }
        : {}),
      ...(panFilter ? { panStatus: panFilter as any } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      email: true,
      donorPersona: true,
      donorCategory: true,
      panStatus: true,
      panVerifiedVia: true,
      isCorporate: true,
      totalDonated: true,
      createdAt: true,
      _count: { select: { donations: true } },
    },
  });

  // Open donor-targeted fraud alerts, for the "needs attention" column
  const donorIds = donors.map((d) => d.id);
  const alerts = donorIds.length
    ? await prisma.fraudAlert.groupBy({
        by: ["entityId"],
        where: { entityType: "DONOR", entityId: { in: donorIds }, resolved: false },
        _count: true,
      })
    : [];
  const alertMap = new Map(alerts.map((a) => [a.entityId, a._count]));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Donors</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {donors.length} donor{donors.length === 1 ? "" : "s"} shown (newest first, max 100). Click a donor for the full 360° view.
        </p>

        {/* Search / filter (GET form — server-rendered) */}
        <form className="mt-6 flex flex-wrap gap-3" method="GET">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search name, email, or PAN…"
            className="flex-1 min-w-[240px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <select
            name="pan"
            defaultValue={panFilter}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="">All PAN statuses</option>
            <option value="VERIFIED">PAN Verified</option>
            <option value="UNVERIFIED">PAN Unverified</option>
            <option value="FAILED">PAN Failed</option>
            <option value="PROVIDER_ERROR">Provider Error (needs review)</option>
          </select>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
          >
            Filter
          </button>
        </form>

        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs font-bold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3">Donor</th>
                <th className="px-4 py-3">Persona</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">PAN</th>
                <th className="px-4 py-3">Donations</th>
                <th className="px-4 py-3">Lifetime ₹</th>
                <th className="px-4 py-3">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {donors.map((d) => {
                const alertCount = alertMap.get(d.id) || 0;
                return (
                  <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/donors/${d.id}`} className="font-semibold text-emerald-600 hover:underline">
                        {d.name}
                      </Link>
                      <p className="text-xs text-gray-400">{d.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {d.donorPersona ?? "—"}
                      {d.isCorporate && <span className="ml-1 text-[10px] font-bold text-blue-500">CORP</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{d.donorCategory ?? "Undeclared"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${PAN_BADGE[d.panStatus] || ""}`}>
                        {d.panStatus}
                      </span>
                      {d.panVerifiedVia === "MOCK" && (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" title="Verified in mock mode — no real provider check was performed">
                          MOCK
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{d._count.donations}</td>
                    <td className="px-4 py-3 text-gray-900 dark:text-white font-semibold">
                      ₹{Number(d.totalDonated).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      {alertCount > 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                          {alertCount} open
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {donors.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                    No donors match this filter.
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
