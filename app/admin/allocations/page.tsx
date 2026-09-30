import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { AllocationStatus, Prisma, ProposalStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { committedTotal, fundingState, paidTotal, remainingBudget } from "@/lib/allocation";
import { ProposeAllocationForm, AllocationDecision, RecordPaymentForm } from "./AllocationActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where an approved plan becomes funded work.
 *
 * Approving a proposal used to be the end of the line: the platform agreed
 * with a plan and nothing recorded that any money was set aside for it, so an
 * opportunity's remaining budget was a number nobody could produce.
 *
 * Three states, in the order an admin moves through them: plans waiting for a
 * funding decision, commitments waiting for approval, and money committed.
 *
 * Nothing here pays anyone. A commitment says an amount is spoken for;
 * disbursement is a separate module and deliberately the last one.
 */

function rupees(value: { toString(): string } | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${Number(value.toString()).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AdminAllocationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  let approvedProposals;
  let allocations;
  try {
    [approvedProposals, allocations] = await Promise.all([
      prisma.proposal.findMany({
        where: { status: ProposalStatus.APPROVED },
        orderBy: { decidedAt: "desc" },
        select: {
          id: true,
          title: true,
          requestedAmount: true,
          decidedAt: true,
          ngo: { select: { id: true, orgName: true } },
          opportunity: { select: { id: true, title: true, funderName: true, amount: true } },
          allocation: { select: { id: true, status: true } },
        },
      }),
      prisma.allocation.findMany({
        orderBy: { proposedAt: "desc" },
        select: {
          id: true,
          amount: true,
          status: true,
          proposedAt: true,
          decidedAt: true,
          decisionNote: true,
          opportunityId: true,
          payments: {
            select: { id: true, amount: true, paidAt: true, reference: true },
            orderBy: { paidAt: "desc" },
          },
          proposal: {
            select: {
              id: true,
              title: true,
              ngo: { select: { orgName: true } },
              opportunity: { select: { title: true, funderName: true } },
            },
          },
        },
      }),
    ]);
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Allocations failed to load" detail={err?.meta?.table || err?.message} />;
    }
    throw err;
  }

  // Committed per opportunity, counting PENDING as well as APPROVED — a draft
  // commitment is already claiming budget, and showing it as available would
  // invite a second allocation that cannot be honoured.
  const byOpportunity = new Map<string, Array<{ status: AllocationStatus; amount: Prisma.Decimal }>>();
  for (const a of allocations) {
    const list = byOpportunity.get(a.opportunityId) ?? [];
    list.push({ status: a.status, amount: a.amount });
    byOpportunity.set(a.opportunityId, list);
  }

  const awaitingDecision = approvedProposals.filter((p) => !p.allocation);
  const pending = allocations.filter((a) => a.status === AllocationStatus.PENDING);
  const decided = allocations.filter((a) => a.status !== AllocationStatus.PENDING);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Allocations</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            Money committed to approved proposals. A commitment says an amount of an
            opportunity&rsquo;s budget is spoken for — it does not move money and does not pay
            anyone. Nothing here can be undone: an organisation that plans work against a
            commitment has to be able to rely on it.
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            Once committed, each one tracks whether the funder&rsquo;s money was actually confirmed
            as received, and by whom. A commitment nobody confirms is chased by reconciliation
            after {" "}
            <strong>30 days</strong> — a promise the platform never checks is worth no more than
            the promise itself.
          </p>
        </div>

        {/* ── Waiting on a funding decision ─────────────────────────────── */}
        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
            Approved plans with no money behind them ({awaitingDecision.length})
          </h2>
          {awaitingDecision.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-10 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Every approved proposal has a funding decision.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {awaitingDecision.map((proposal) => {
                const committed = committedTotal(byOpportunity.get(proposal.opportunity.id) ?? []);
                const remaining = remainingBudget(proposal.opportunity.amount, committed);
                return (
                  <li
                    key={proposal.id}
                    className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          {proposal.ngo.orgName}
                          <span className="text-gray-400 font-normal"> · {proposal.title}</span>
                        </p>
                        <p className="text-xs text-gray-400">
                          {proposal.opportunity.title} · funded by {proposal.opportunity.funderName}
                          {proposal.decidedAt &&
                            ` · approved ${proposal.decidedAt.toLocaleDateString("en-IN")}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          {rupees(proposal.requestedAmount)}
                        </p>
                        <p className="text-xs text-gray-400">requested</p>
                      </div>
                    </div>
                    <ProposeAllocationForm
                      proposalId={proposal.id}
                      requestedAmount={proposal.requestedAmount.toFixed(2)}
                      remaining={remaining === null ? null : remaining.toFixed(2)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Waiting on approval ───────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
            Commitments awaiting approval ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-10 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Nothing is waiting on a signature.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((allocation) => (
                <li
                  key={allocation.id}
                  className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-gray-900 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">
                        {allocation.proposal.ngo.orgName}
                        <span className="text-gray-400 font-normal"> · {allocation.proposal.title}</span>
                      </p>
                      <p className="text-xs text-gray-400">
                        from {allocation.proposal.opportunity.funderName} ·{" "}
                        {allocation.proposal.opportunity.title} · proposed{" "}
                        {allocation.proposedAt.toLocaleDateString("en-IN")}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white shrink-0">
                      {rupees(allocation.amount)}
                    </p>
                  </div>
                  <AllocationDecision allocationId={allocation.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Decided ───────────────────────────────────────────────────── */}
        {decided.length > 0 && (
          <section>
            <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
              Decided ({decided.length})
            </h2>
            <ul className="space-y-2">
              {decided.map((allocation) => (
                <li
                  key={allocation.id}
                  className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {allocation.proposal.opportunity.funderName}
                        <span className="text-gray-400 font-normal"> → </span>
                        {allocation.proposal.ngo.orgName}
                      </p>
                      <p className="text-xs text-gray-400">
                        {allocation.proposal.opportunity.title} · {allocation.proposal.title}
                      </p>
                      <p className="text-xs text-gray-400">
                        {allocation.status === AllocationStatus.APPROVED ? "committed" : "rejected"}{" "}
                        {allocation.decidedAt?.toLocaleDateString("en-IN")}
                      </p>
                      {allocation.decisionNote && (
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          {allocation.decisionNote}
                        </p>
                      )}
                    </div>
                    <p
                      className={`text-sm font-bold shrink-0 ${
                        allocation.status === AllocationStatus.APPROVED
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-gray-400 line-through"
                      }`}
                    >
                      {rupees(allocation.amount)}
                    </p>
                  </div>

                  {allocation.status === AllocationStatus.APPROVED &&
                    (() => {
                      // Derived on every render from the payment rows. A cached
                      // paid-total would be one more counter able to drift from
                      // the evidence behind it.
                      const paid = paidTotal(allocation.payments);
                      const state = fundingState(allocation.amount, paid);
                      const outstanding = new Prisma.Decimal(allocation.amount.toString()).minus(paid);
                      const tone =
                        state === "FUNDED"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : state === "UNFUNDED"
                            ? "text-amber-700 dark:text-amber-400"
                            : state === "OVERFUNDED"
                              ? "text-red-700 dark:text-red-400"
                              : "text-gray-600 dark:text-gray-300";
                      return (
                        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                          <p className={`text-xs font-bold ${tone}`}>
                            {state === "UNFUNDED"
                              ? "No money confirmed as received yet"
                              : state === "FUNDED"
                                ? `Fully confirmed — ${rupees(paid)} received`
                                : state === "OVERFUNDED"
                                  ? `More confirmed than committed — ${rupees(paid)} against ${rupees(allocation.amount)}`
                                  : `${rupees(paid)} of ${rupees(allocation.amount)} confirmed · ${rupees(outstanding)} outstanding`}
                          </p>
                          {allocation.payments.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {allocation.payments.map((payment) => (
                                <li key={payment.id} className="text-xs text-gray-400">
                                  {rupees(payment.amount)} on{" "}
                                  {payment.paidAt.toLocaleDateString("en-IN")} ·{" "}
                                  {payment.reference ? (
                                    <span className="font-mono">{payment.reference}</span>
                                  ) : (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      no reference — nothing to match this against
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {state !== "FUNDED" && state !== "OVERFUNDED" && (
                            <div className="mt-2">
                              <RecordPaymentForm
                                allocationId={allocation.id}
                                outstanding={outstanding.toFixed(2)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })()}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-gray-400">
          Every commitment is also written to the money log as a separate entry, on the commitment
          plane rather than the cash one — see{" "}
          <Link href="/admin/finance" className="underline">
            Finance
          </Link>
          . It is kept out of the cash balances and out of reconciliation, because no money has
          moved.
        </p>
      </div>
    </div>
  );
}
