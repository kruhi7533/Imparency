import Link from "next/link";
import prisma from "@/lib/prisma";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Donor organisation verification queue (roadmap row 6, "verification queue").
 *
 * NGOs had a queue; companies did not — a CSR account waiting for approval was
 * only findable by filtering the donor list. Until it is VERIFIED a company
 * cannot put a requirement in front of NGOs, so this is a real blocker for the
 * donor and belongs next to NGO approvals. Oldest submission first. The decision
 * itself happens on the donor's page (OrgVerificationActions), unchanged.
 */
const DAY = 86_400_000;

export default async function DonorOrgQueuePage() {
  let pending;
  try {
    pending = await prisma.user.findMany({
      where: { role: "DONOR", orgVerificationStatus: "PENDING" },
      orderBy: [{ orgSubmittedAt: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: {
        id: true,
        companyName: true,
        name: true,
        cin: true,
        donorPersona: true,
        orgSubmittedAt: true,
        createdAt: true,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Donor organisation queue failed to load" detail={err?.meta?.column || err?.message} />;
    }
    throw err;
  }

  const now = Date.now();
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Donor organisations awaiting verification</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            Companies and foundations cannot put a CSR requirement in front of NGOs until they are verified. Oldest first;
            open one to check its CIN and decide.
          </p>
        </div>

        {pending.length === 0 ? (
          <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/30 dark:text-emerald-400">
            No organisation is waiting.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead>
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Organisation</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">CIN</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Waiting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {pending.map((d) => {
                  const since = d.orgSubmittedAt ?? d.createdAt;
                  const days = Math.floor((now - since.getTime()) / DAY);
                  return (
                    <tr key={d.id}>
                      <td className="px-4 py-3">
                        <Link href={`/admin/donors/${d.id}`} className="text-sm font-bold text-gray-900 hover:underline dark:text-white">
                          {d.companyName || d.name || "Unnamed organisation"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {(d.donorPersona ?? "").replace(/_/g, " ").toLowerCase() || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{d.cin ?? "Not provided"}</td>
                      <td className={`px-4 py-3 text-sm font-semibold ${days >= 3 ? "text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}`}>
                        {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
