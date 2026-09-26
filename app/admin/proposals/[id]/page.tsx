import prisma from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { formatCompactINR } from "@/lib/format-currency";
import ProposalActions from "./ProposalActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One proposal, and the decision on it.
 *
 * The shortlisting that entitles this organisation to propose is shown
 * explicitly: an admin approving funding should be able to see, without
 * leaving the page, that the engine and a human both already judged this
 * organisation eligible for this opportunity.
 */
export default async function AdminProposalPage({ params }: { params: { id: string } }) {
  let proposal;
  try {
    proposal = await prisma.proposal.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        title: true,
        summary: true,
        plan: true,
        status: true,
        requestedAmount: true,
        submittedAt: true,
        decidedAt: true,
        decisionNote: true,
        ngo: { select: { id: true, orgName: true, verificationStatus: true } },
        opportunity: {
          select: { id: true, title: true, funderName: true, status: true },
        },
        reviewer: { select: { name: true, email: true } },
      },
    });
  } catch (err: any) {
    return <SchemaOutOfSync title="Proposal failed to load" detail={err?.message ?? String(err)} />;
  }

  if (!proposal) notFound();

  // The entitlement behind this proposal. Shown rather than assumed.
  const shortlisting = await prisma.matchCandidate.findFirst({
    where: { ngoId: proposal.ngo.id, decision: "SHORTLISTED", job: { opportunityId: proposal.opportunity.id } },
    select: { decidedAt: true, verdict: true, jobId: true, job: { select: { opportunityId: true } } },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <Link
          href="/admin/proposals"
          className="text-xs text-gray-500 dark:text-gray-400 hover:underline"
        >
          ← All proposals
        </Link>

        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-400">
            {proposal.status.replace(/_/g, " ")}
          </span>
          <h1 className="mt-1 text-2xl font-extrabold text-gray-900 dark:text-white">
            {proposal.title}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            <Link href={`/admin/ngos/${proposal.ngo.id}`} className="text-emerald-600 hover:underline dark:text-emerald-400">
              {proposal.ngo.orgName}
            </Link>{" "}
            · for{" "}
            <Link
              href={`/admin/opportunities/${proposal.opportunity.id}`}
              className="text-emerald-600 hover:underline dark:text-emerald-400"
            >
              {proposal.opportunity.title}
            </Link>{" "}
            ({proposal.opportunity.funderName})
          </p>
        </div>

        {/* Entitlement — why this organisation may propose at all. */}
        {shortlisting ? (
          <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3">
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              Shortlisted for this opportunity
              {shortlisting.decidedAt ? ` on ${shortlisting.decidedAt.toLocaleDateString("en-IN")}` : ""} — the
              engine judged this organisation {shortlisting.verdict.toLowerCase()} and an admin agreed.{" "}
              <Link
                href={`/admin/opportunities/${shortlisting.job.opportunityId}/jobs/${shortlisting.jobId}`}
                className="underline"
              >
                See the scoring
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-950/20 px-4 py-3">
            <p className="text-sm text-red-800 dark:text-red-300">
              No shortlisting found for this organisation on this opportunity. A proposal should not
              exist without one — treat this as a data problem before deciding anything.
            </p>
          </div>
        )}

        <dl className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Requested</dt>
            <dd className="mt-0.5 text-lg font-extrabold text-gray-900 dark:text-white">
              {formatCompactINR(Number(proposal.requestedAmount))}
            </dd>
          </div>
          <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Submitted</dt>
            <dd className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
              {proposal.submittedAt ? proposal.submittedAt.toLocaleString("en-IN") : "Not yet submitted"}
            </dd>
          </div>
        </dl>

        <section className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-4">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400">Summary</h2>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {proposal.summary}
          </p>
          {proposal.plan && (
            <>
              <h2 className="mt-4 text-xs font-extrabold uppercase tracking-wide text-gray-400">Plan</h2>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {proposal.plan}
              </p>
            </>
          )}
        </section>

        {proposal.decidedAt && (
          <section className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-4">
            <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400">Decision</h2>
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {proposal.status.replace(/_/g, " ").toLowerCase()} on{" "}
              {proposal.decidedAt.toLocaleString("en-IN")}
              {proposal.decisionNote ? ` — ${proposal.decisionNote}` : ""}
            </p>
          </section>
        )}

        <section className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-4">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
            Decision
          </h2>
          {proposal.reviewer && proposal.status === "UNDER_REVIEW" && (
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Taken up by {proposal.reviewer.name || proposal.reviewer.email}.
            </p>
          )}
          <ProposalActions proposalId={proposal.id} status={proposal.status} />
        </section>
      </div>
    </div>
  );
}
