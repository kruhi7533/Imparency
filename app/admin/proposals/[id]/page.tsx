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
    <div className="py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <Link
          href="/admin/proposals"
          className="text-xs text-gray-500 hover:underline"
        >
          ← All proposals
        </Link>

        <div>
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
            {proposal.status.replace(/_/g, " ")}
          </span>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-1 text-gray-900">
            {proposal.title}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            <Link href={`/admin/ngos/${proposal.ngo.id}`} className="text-emerald-600 hover:underline">
              {proposal.ngo.orgName}
            </Link>{" "}
            · for{" "}
            <Link
              href={`/admin/opportunities/${proposal.opportunity.id}`}
              className="text-emerald-600 hover:underline"
            >
              {proposal.opportunity.title}
            </Link>{" "}
            ({proposal.opportunity.funderName})
          </p>
        </div>

        {/* Entitlement — why this organisation may propose at all. */}
        {shortlisting ? (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-800">
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
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-800">
              No shortlisting found for this organisation on this opportunity. A proposal should not
              exist without one — treat this as a data problem before deciding anything.
            </p>
          </div>
        )}

        <dl className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200/80 bg-white px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Requested</dt>
            <dd className="mt-0.5 text-lg font-bold text-gray-900">
              {formatCompactINR(Number(proposal.requestedAmount))}
            </dd>
          </div>
          <div className="rounded-xl border border-gray-200/80 bg-white px-4 py-3">
            <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Submitted</dt>
            <dd className="mt-0.5 text-sm text-gray-700">
              {proposal.submittedAt ? proposal.submittedAt.toLocaleString("en-IN") : "Not yet submitted"}
            </dd>
          </div>
        </dl>

        <section className="rounded-xl border border-gray-200/80 bg-white px-4 py-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">Summary</h2>
          <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
            {proposal.summary}
          </p>
          {proposal.plan && (
            <>
              <h2 className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500">Plan</h2>
              <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                {proposal.plan}
              </p>
            </>
          )}
        </section>

        {proposal.decidedAt && (
          <section className="rounded-xl border border-gray-200/80 bg-white px-4 py-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">Decision</h2>
            <p className="mt-2 text-sm text-gray-700">
              {proposal.status.replace(/_/g, " ").toLowerCase()} on{" "}
              {proposal.decidedAt.toLocaleString("en-IN")}
              {proposal.decisionNote ? ` — ${proposal.decisionNote}` : ""}
            </p>
          </section>
        )}

        <section className="rounded-xl border border-gray-200/80 bg-white px-4 py-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">
            Decision
          </h2>
          {proposal.reviewer && proposal.status === "UNDER_REVIEW" && (
            <p className="mb-3 text-xs text-gray-500">
              Taken up by {proposal.reviewer.name || proposal.reviewer.email}.
            </p>
          )}
          <ProposalActions proposalId={proposal.id} status={proposal.status} />
        </section>
      </div>
    </div>
  );
}
