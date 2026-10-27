import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { resolveNgoActor } from "@/lib/field-evidence";
import { loadNgoImpactReport } from "@/lib/ngo-impact-report";
import { formatOutcome, rollupFigure } from "@/lib/outcome-format";
import PrintButton from "@/app/donor/impact-report/PrintButton";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  SUBMITTED: "In review",
  NEEDS_EVIDENCE: "Returned for evidence",
  APPROVED: "Approved",
};

/**
 * NGO impact report draft (NGO-017 / NGO-018). Built from the same data and
 * rules as the funder's report: a figure is shown as a number only when it is
 * approved and still backed, a baseline → endline change only when two
 * verified figures support it (INSUFFICIENT_DATA otherwise), and the funder
 * sees beneficiary feedback only as consented aggregates.
 */
export default async function NgoImpactReportPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/ngo/impact/report");
  if (session.user.role !== "NGO") redirect("/unauthorized");
  const actor = await resolveNgoActor(session.user.id);
  if (!actor) redirect("/ngo/register");

  const report = await loadNgoImpactReport(actor.ngoId);
  const generated = new Date(report.generatedAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const fb = report.feedbackOverall;

  return (
    <div className="min-h-screen bg-gray-950 print:bg-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-gray-100 print:text-black space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300 print:text-black">Draft</p>
            <h1 className="text-2xl font-extrabold text-white print:text-black">Impact report</h1>
            <p className="mt-1 text-sm text-gray-400 print:text-gray-700">Generated {generated}</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Link href="/ngo/impact" className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-700 text-sm font-bold text-gray-200 hover:bg-gray-900">
              Back to cockpit
            </Link>
            <PrintButton />
          </div>
        </div>

        <p className="text-xs text-gray-400 print:text-gray-700 max-w-3xl">
          Only figures that passed impact review and are still backed by approved evidence appear as numbers — exactly what your
          funders see. Everything else reads <strong>unverified</strong>. A change over time is shown only when two verified figures
          for the same metric support it; otherwise it reads <span className="font-mono">INSUFFICIENT_DATA</span>.
        </p>

        <section aria-labelledby="totals-h">
          <h2 id="totals-h" className="text-sm font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">Across your projects</h2>
          {report.rollup.length === 0 ? (
            <p className="mt-2 text-sm text-gray-300 print:text-black">
              No outcomes reported yet. <Link href="/ngo/impact" className="underline">Report one in the impact cockpit.</Link>
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.rollup.map((m) => (
                <li key={m.metricCode} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 print:border-gray-300 print:bg-white">
                  <p className="text-xs text-gray-400 print:text-gray-700">{m.metricName}</p>
                  <p className="mt-1 text-2xl font-extrabold text-emerald-300 print:text-black">{rollupFigure(m) ?? "Unverified"}</p>
                  <p className="mt-1 text-[11px] text-gray-400 print:text-gray-700">
                    {m.verifiedCount} verified · {m.inReviewCount} in review
                    {m.unverifiedApprovedCount > 0 ? ` · ${m.unverifiedApprovedCount} approved but no longer backed` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="fb-h" className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 print:border-gray-300 print:bg-white">
          <h2 id="fb-h" className="text-sm font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">Beneficiary feedback (all projects)</h2>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <Stat label="Captured" value={fb.captured} />
            <Stat label="Consented" value={fb.consented} />
            <Stat label="Refused" value={fb.refused} />
            <Stat label="Withdrawn" value={fb.withdrawn} />
            <Stat label="Average rating" value={fb.averageRating ? `${fb.averageRating} / 5` : "—"} />
          </dl>
          <p className="mt-2 text-[11px] text-gray-400 print:text-gray-700">
            Ratings and comments count only consented, not-withdrawn responses. Funders see aggregates only, never comments or
            references, and nothing for a project with fewer than 5 consenting respondents.
          </p>
        </section>

        <section aria-labelledby="projects-h" className="space-y-6">
          <h2 id="projects-h" className="text-sm font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">By project</h2>
          {report.projects.length === 0 && <p className="text-sm text-gray-300">No projects yet.</p>}
          {report.projects.map((p) => (
            <article key={p.id} className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 break-inside-avoid print:border-gray-300 print:bg-white">
              <h3 className="text-base font-bold text-white print:text-black">{p.title}</h3>
              <p className="text-xs text-gray-400 print:text-gray-700">
                Field evidence: {p.evidence.APPROVED} approved · {p.evidence.PENDING_REVIEW} pending review · {p.evidence.RESUBMIT_REQUESTED} returned ·{" "}
                {p.evidence.REJECTED} rejected
              </p>

              {p.figures.length === 0 ? (
                <p className="mt-3 text-xs text-gray-400 print:text-gray-700">No outcome figures reported for this project.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <caption className="sr-only">Outcome figures for {p.title}</caption>
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 print:text-gray-700">
                        <th scope="col" className="py-2 pr-4">Outcome</th>
                        <th scope="col" className="py-2 pr-4">You reported</th>
                        <th scope="col" className="py-2 pr-4">Funders see</th>
                        <th scope="col" className="py-2">Period</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800 print:divide-gray-300">
                      {p.figures.map((f) => (
                        <tr key={f.id}>
                          <td className="py-2 pr-4">
                            {f.metricName}
                            <span className="block text-[11px] text-gray-400 print:text-gray-700">{STATUS_TEXT[f.status] ?? f.status}</span>
                          </td>
                          <td className="py-2 pr-4">{formatOutcome(f.value, f.unit)}</td>
                          <td className="py-2 pr-4 font-bold">
                            {f.display.kind === "verified" ? (
                              <span className="text-emerald-300 print:text-black">{formatOutcome(f.display.value, f.display.unit)}</span>
                            ) : (
                              <span className="text-amber-300 print:text-black" title={f.display.reason}>
                                Unverified
                                {f.blockingFindings.length > 0 && (
                                  <span className="block text-[11px] font-normal text-gray-400 print:text-gray-700">{f.blockingFindings.join(", ")}</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-gray-300 print:text-black whitespace-nowrap">
                            {new Date(f.periodStart).toLocaleDateString("en-IN")} – {new Date(f.periodEnd).toLocaleDateString("en-IN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {p.changes.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">Baseline → endline</h4>
                  <ul className="mt-1 space-y-1 text-sm">
                    {p.changes.map((c) => (
                      <li key={c.metricCode}>
                        {c.metricName}:{" "}
                        {c.status === "COMPUTED" ? (
                          <>
                            <strong className="text-emerald-300 print:text-black">{c.label}</strong>{" "}
                            <span className="text-xs text-gray-400 print:text-gray-700">
                              ({formatOutcome(c.baseline.value, c.unit)} → {formatOutcome(c.endline.value, c.unit)})
                            </span>
                          </>
                        ) : (
                          <>
                            <strong className="font-mono text-amber-300 print:text-black">INSUFFICIENT_DATA</strong>{" "}
                            <span className="text-xs text-gray-400 print:text-gray-700">{c.reason}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">Beneficiary feedback (your view)</h4>
                  {p.feedback ? (
                    <>
                      <p className="mt-1">
                        {p.feedback.consented} consented of {p.feedback.captured} captured
                        {p.feedback.averageRating ? ` · average ${p.feedback.averageRating} / 5` : ""}
                      </p>
                      {p.feedback.comments.slice(0, 3).map((c, i) => (
                        <p key={i} className="mt-1 text-xs text-gray-300 print:text-black">
                          “{c.text}” {c.ref ? <span className="text-gray-500">— {c.ref}</span> : null}
                        </p>
                      ))}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-gray-400">No feedback captured.</p>
                  )}
                </div>
                <div>
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 print:text-gray-700">What funders see</h4>
                  {p.donorFeedbackPreview.status === "AVAILABLE" ? (
                    <p className="mt-1">
                      {p.donorFeedbackPreview.respondents} consenting respondents
                      {p.donorFeedbackPreview.averageRating ? ` · average ${p.donorFeedbackPreview.averageRating} / 5` : ""}
                    </p>
                  ) : (
                    <p className="mt-1">
                      <strong className="font-mono text-amber-300 print:text-black">INSUFFICIENT_DATA</strong>{" "}
                      <span className="text-xs text-gray-400 print:text-gray-700">{p.donorFeedbackPreview.reason}</span>
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400 print:text-gray-700">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
