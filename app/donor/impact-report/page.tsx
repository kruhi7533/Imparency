import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { loadDonorImpact } from "@/lib/donor-impact";
import { formatOutcome, inr } from "@/lib/outcome-format";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * The donor's impact across every project they fund — and, printed, their
 * approved impact report (roadmap row 12). Only figures that passed impact
 * review and are still backed by evidence appear as numbers; everything else
 * reads "unverified".
 */
export default async function DonorImpactReportPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/donor/impact-report");
  if (session.user.role !== "DONOR") redirect("/unauthorized");

  const report = await loadDonorImpact(session.user.id);
  const generated = new Date(report.generatedAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const verifiedClaims = report.projects.flatMap((p) => p.outcomes).filter((o) => o.display.kind === "verified").length;
  const allClaims = report.projects.flatMap((p) => p.outcomes).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-gray-100 print:text-black print:bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white print:text-black">Impact report</h1>
          <p className="mt-1 text-sm text-gray-400 print:text-gray-700">
            {session.user.name ? `${session.user.name} · ` : ""}Generated {generated}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <a
            href="/api/donor/impact-report"
            className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-700 text-sm font-bold text-gray-200 hover:bg-gray-900"
          >
            Download CSV
          </a>
          <PrintButton />
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400 print:text-gray-700 max-w-3xl">
        Figures are shown only when they passed the platform&apos;s impact review and their evidence still supports them;
        anything else reads <strong>unverified</strong>. Outcomes are reported for the whole project — they are not divided by
        your share of its funding.
      </p>

      {report.projects.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-gray-800 p-8 text-center">
          <p className="text-sm text-gray-300">You are not funding any project yet.</p>
          <Link href="/discover" className="mt-3 inline-block text-sm font-bold text-emerald-400 underline">
            Discover NGOs
          </Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="portfolio-h" className="mt-8">
            <h2 id="portfolio-h" className="text-sm font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">
              Across your portfolio
            </h2>
            <p className="mt-1 text-xs text-gray-400 print:text-gray-700">
              {report.projects.length} project{report.projects.length === 1 ? "" : "s"} · {verifiedClaims} of {allClaims} reported figure
              {allClaims === 1 ? "" : "s"} verified
            </p>
            {report.portfolio.length === 0 ? (
              <p className="mt-3 text-sm text-gray-300 print:text-black">No outcomes have been reported on your projects yet.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {report.portfolio.map((m) => (
                  <li key={m.metricCode} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 print:border-gray-300 print:bg-white">
                    <p className="text-xs text-gray-400 print:text-gray-700">{m.metricName}</p>
                    <p className="mt-1 text-2xl font-extrabold text-emerald-300 print:text-black">
                      {m.verifiedCount > 0 ? formatOutcome(m.verifiedTotal, m.unit) : "Unverified"}
                    </p>
                    <p className="mt-1 text-[11px] text-gray-400 print:text-gray-700">
                      {m.verifiedCount} verified
                      {m.inReviewCount + m.unverifiedApprovedCount > 0
                        ? ` · ${m.inReviewCount + m.unverifiedApprovedCount} unverified, not counted`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="projects-h" className="mt-10 space-y-6">
            <h2 id="projects-h" className="text-sm font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">
              By project
            </h2>
            {report.projects.map((p) => (
              <article key={p.projectId} className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 break-inside-avoid print:border-gray-300 print:bg-white">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-white print:text-black">
                      <Link href={`/donor/funded/${p.projectId}`} className="hover:underline print:no-underline">
                        {p.title}
                      </Link>
                    </h3>
                    <p className="text-xs text-gray-400 print:text-gray-700">
                      {p.ngoName}
                      {p.location ? ` · ${p.location}` : ""}
                      {p.causeCategory ? ` · ${p.causeCategory}` : ""}
                    </p>
                  </div>
                  {p.fundedAt && (
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300 print:text-black print:border print:border-gray-400">
                      Fully funded · {new Date(p.fundedAt).toLocaleDateString("en-IN")}
                    </span>
                  )}
                </div>

                <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <dt className="text-[11px] text-gray-400 print:text-gray-700">You committed (contracts)</dt>
                    <dd className="font-bold">{inr(p.contribution.contractCommitted)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-gray-400 print:text-gray-700">Confirmed received</dt>
                    <dd className="font-bold">{inr(p.contribution.contractReconciled)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-gray-400 print:text-gray-700">You donated</dt>
                    <dd className="font-bold">{inr(p.contribution.donated)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-gray-400 print:text-gray-700">Milestones verified</dt>
                    <dd className="font-bold">
                      {p.milestones.verified} of {p.milestones.total}
                    </dd>
                  </div>
                </dl>

                {p.outcomes.length === 0 ? (
                  <p className="mt-4 text-xs text-gray-400 print:text-gray-700">No outcomes reported yet.</p>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <caption className="sr-only">Reported outcomes for {p.title}</caption>
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 print:text-gray-700">
                          <th scope="col" className="py-2 pr-4">Outcome</th>
                          <th scope="col" className="py-2 pr-4">Figure</th>
                          <th scope="col" className="py-2">Period</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800 print:divide-gray-300">
                        {p.outcomes.map((o) => (
                          <tr key={o.id}>
                            <td className="py-2 pr-4">{o.metricName}</td>
                            <td className="py-2 pr-4 font-bold">
                              {o.display.kind === "verified" ? (
                                <span className="text-emerald-300 print:text-black">{formatOutcome(o.display.value, o.display.unit)}</span>
                              ) : (
                                <span className="text-amber-300 print:text-black" title={o.display.reason}>
                                  Unverified
                                </span>
                              )}
                            </td>
                            <td className="py-2 text-gray-300 print:text-black whitespace-nowrap">
                              {new Date(o.periodStart).toLocaleDateString("en-IN")} – {new Date(o.periodEnd).toLocaleDateString("en-IN")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
