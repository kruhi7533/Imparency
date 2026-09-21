import prisma from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { RULES, isRuleKind } from "@/lib/matching/rules";
import OpportunityActions from "./OpportunityActions";
import CriteriaEditor from "./CriteriaEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One opportunity: the criteria it declares, and every matching run against it. */

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  SUBMITTED: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  CLOSED: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const JOB_BADGE: Record<string, string> = {
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  RUNNING: "text-amber-600 dark:text-amber-400",
  QUEUED: "text-amber-600 dark:text-amber-400",
  FAILED: "text-red-600 dark:text-red-400",
};

function describeCriterion(kind: string, value: string | null, values: string[]): string {
  if (!isRuleKind(kind)) return "Unrecognised criterion — this engine does not implement it.";
  const rule = RULES[kind];
  if (rule.param === "scalar") return value ? `Minimum ${value}` : "No value set";
  if (rule.param === "set") return values.length ? values.join(", ") : "No values set";
  return "Required";
}

export default async function OpportunityDetailPage({ params }: { params: { id: string } }) {
  let opportunity;
  try {
    opportunity = await prisma.fundingOpportunity.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        funderName: true,
        description: true,
        status: true,
        createdAt: true,
        amount: true,
        funderUser: {
          select: { id: true, name: true, email: true, companyName: true, panStatus: true },
        },
        criteria: {
          orderBy: { createdAt: "asc" },
          select: { id: true, kind: true, value: true, values: true, required: true },
        },
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            status: true,
            createdAt: true,
            finishedAt: true,
            evaluatedCount: true,
            eligibleCount: true,
            ineligibleCount: true,
            unknownCount: true,
          },
        },
      },
    });
  } catch (err: any) {
    return <SchemaOutOfSync title="Opportunity failed to load" detail={err?.message ?? String(err)} />;
  }

  if (!opportunity) notFound();

  const hasInFlightJob = opportunity.jobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link href="/admin/opportunities" className="text-xs font-semibold text-gray-500 hover:text-emerald-600">
          ← All opportunities
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">{opportunity.title}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{opportunity.funderName}</p>
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_BADGE[opportunity.status] ?? ""}`}>
            {opportunity.status}
          </span>
        </div>

        {opportunity.description && (
          <p className="mt-4 text-sm text-gray-700 dark:text-gray-300 max-w-3xl">{opportunity.description}</p>
        )}

        {/* Whether the funder can be reached at all is the difference between
            "they will be told" and "you will have to tell them yourself". */}
        {opportunity.amount !== null && (
          <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
            ₹{Number(opportunity.amount).toLocaleString("en-IN")} offered
          </p>
        )}

        {/* Whether there is a checked identity behind the money. This is the
            condition for opening, so it is stated before the buttons. */}
        {!opportunity.funderUser ? (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            No funder account linked. &ldquo;{opportunity.funderName}&rdquo; is a label only — nobody is
            notified on the funder side, and this opportunity cannot be opened until a verified
            donor account stands behind it.
          </p>
        ) : opportunity.funderUser.panStatus !== "VERIFIED" ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">
            Funder{" "}
            {opportunity.funderUser.companyName || opportunity.funderUser.name || opportunity.funderUser.email}{" "}
            is not identity-verified (PAN {opportunity.funderUser.panStatus.toLowerCase()}). Verify
            their PAN on the{" "}
            <Link href={`/admin/donors/${opportunity.funderUser.id}`} className="underline">
              donor record
            </Link>{" "}
            before opening — an unverified funder must not be put in front of an organisation.
          </p>
        ) : (
          <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
            Funder{" "}
            {opportunity.funderUser.companyName || opportunity.funderUser.name || opportunity.funderUser.email}{" "}
            is identity-verified, and is notified whenever an organisation is shortlisted.
          </p>
        )}

        <div className="mt-6">
          <OpportunityActions
            opportunityId={opportunity.id}
            status={opportunity.status}
            criteriaCount={opportunity.criteria.length}
            hasInFlightJob={hasInFlightJob}
          />
        </div>

        <section className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Criteria
            </h2>
            <CriteriaEditor
              opportunityId={opportunity.id}
              initial={opportunity.criteria}
              disabled={opportunity.status === "CLOSED" || opportunity.status === "REJECTED"}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Only these are evaluated. Anything not listed here is never considered — so an
            organisation is not judged on a credential this funder did not ask for.
            {(opportunity.status === "CLOSED" || opportunity.status === "REJECTED") &&
              " This opportunity is finished, so criteria can no longer be revised."}
          </p>

          <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
            {opportunity.criteria.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-sm font-semibold text-gray-900 dark:text-white min-w-[200px]">
                  {isRuleKind(c.kind) ? RULES[c.kind].label : c.kind}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {describeCriterion(c.kind, c.value, c.values)}
                </span>
                {!c.required && (
                  <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
                    PREFERRED
                  </span>
                )}
              </div>
            ))}
            {opportunity.criteria.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
                No criteria yet. An opportunity with no criteria cannot be opened — it would match
                every organisation on the platform.
              </p>
            )}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Matching runs
          </h2>

          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-950/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Run</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Evaluated</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {opportunity.jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/opportunities/${opportunity.id}/jobs/${j.id}`}
                        className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                      >
                        {j.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                      </Link>
                    </td>
                    <td className={`px-4 py-3 text-sm font-semibold ${JOB_BADGE[j.status] ?? ""}`}>{j.status}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 tabular-nums">{j.evaluatedCount}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 tabular-nums">
                      {j.eligibleCount} eligible · {j.ineligibleCount} not · {j.unknownCount} unknown
                    </td>
                  </tr>
                ))}
                {opportunity.jobs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                      No matching runs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
