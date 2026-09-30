import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { FinanceExceptionStatus, FinanceExceptionType, LedgerDirection } from "@prisma/client";
import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { netAmount, CASH_ENTRY_TYPES } from "@/lib/ledger";
import { loadFinanceLabels, shortId, EMPTY_LABELS, type FinanceLabels } from "@/lib/finance-labels";
import { RunReconciliationButton, ResolveExceptionForm } from "./FinanceActions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The finance control plane: what the ledger says, what does not add up, and
 * when it was last checked.
 *
 * Before this, admin finance was four aggregate sums on the dashboard — totals
 * with nothing to check them against. The three sections here answer the three
 * questions those sums could not: is it consistent (exceptions), what is it
 * made of (ledger), and is anyone actually looking (last run).
 *
 * Read-only except for two actions: run the reconciler, and close a finding
 * with a note.
 */

/** Plain-language label per exception type — the enum name is not an answer. */
const EXCEPTION_LABEL: Record<FinanceExceptionType, string> = {
  UNMATCHED_PAYMENT: "Payment with no donation record",
  MISSING_LEDGER_ENTRY: "Confirmed donation missing from the ledger",
  PROJECT_TOTAL_MISMATCH: "Project raised total disagrees with the ledger",
  DONOR_TOTAL_MISMATCH: "Donor lifetime total disagrees with the ledger",
  STALE_PENDING_DONATION: "Donation stuck pending",
  PAYMENT_AMOUNT_MISMATCH: "Captured amount differs from the donation",
  REFUND_AFTER_RECEIPT: "Refund on a donation with an 80G receipt issued",
};

/**
 * Severity is a property of the TYPE, not of the amount. An unmatched payment
 * of ₹100 is still money we took and cannot account for; a ₹100 drift on a
 * counter is an arithmetic error. Ranking by amount would bury the first kind
 * under the second.
 */
const SEVERE: FinanceExceptionType[] = [
  FinanceExceptionType.UNMATCHED_PAYMENT,
  FinanceExceptionType.MISSING_LEDGER_ENTRY,
  // The provider took a different amount than we recorded. No other check can
  // find this one, because every other check compares our records against our
  // own records.
  FinanceExceptionType.PAYMENT_AMOUNT_MISMATCH,
  // A tax document exists for money that was given back.
  FinanceExceptionType.REFUND_AFTER_RECEIPT,
];

function rupees(value: { toString(): string } | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${Number(value.toString()).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Who a finding is actually about, in words.
 *
 * An exception card used to read "DONATION f7da6928-b098-…", which tells an
 * admin nothing they can act on — they had to go and look every id up by hand
 * before they could even judge whether the finding mattered. Resolved from the
 * live tables at render time; see lib/finance-labels.ts for why the names are
 * not stored on the row itself.
 *
 * An UNMATCHED_PAYMENT deliberately resolves to nothing: not knowing who it
 * belongs to IS the finding.
 */
function describeSubject(
  exception: { entityType: string; entityId: string },
  labels: FinanceLabels,
): { line: string; sub?: string } | null {
  if (exception.entityType === "DONOR") {
    const name = labels.donors.get(exception.entityId);
    return name ? { line: name } : null;
  }
  if (exception.entityType === "PROJECT") {
    const project = labels.projects.get(exception.entityId);
    return project ? { line: project.orgName, sub: project.title } : null;
  }
  if (exception.entityType === "DONATION") {
    const donation = labels.donations.get(exception.entityId);
    if (!donation) return null;
    const donor = labels.donors.get(donation.donorId) ?? shortId(donation.donorId);
    const project = labels.projects.get(donation.projectId);
    return {
      line: `${donor} → ${project?.orgName ?? shortId(donation.projectId)}`,
      sub: project?.title,
    };
  }
  return null;
}

export default async function AdminFinancePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  let exceptions;
  let entries;
  let lastRun;
  let totals;
  try {
    [exceptions, entries, lastRun, totals] = await Promise.all([
      prisma.financeException.findMany({
        where: { status: FinanceExceptionStatus.OPEN },
        orderBy: { lastSeenAt: "desc" },
        take: 100,
      }),
      prisma.ledgerEntry.findMany({
        orderBy: { occurredAt: "desc" },
        take: 25,
      }),
      prisma.reconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
      // Cash only: the headline figure answers "what did we receive and keep",
      // and netting commitments into it would understate that by whatever has
      // been promised but not yet paid out.
      prisma.ledgerEntry.groupBy({
        by: ["direction"],
        where: { entryType: { in: CASH_ENTRY_TYPES } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Finance view failed to load" detail={err?.meta?.table || err?.message} />;
    }
    throw err;
  }

  // One batched lookup for both tables. Best-effort: if it fails, the page
  // still renders with ids — a finance view that 500s because a name could not
  // be found would be a worse trade than an unfriendly one.
  let labels: FinanceLabels = EMPTY_LABELS;
  try {
    labels = await loadFinanceLabels({
      donorIds: [
        ...entries.map((e) => e.donorId),
        ...exceptions.filter((e) => e.entityType === "DONOR").map((e) => e.entityId),
      ],
      projectIds: [
        ...entries.map((e) => e.projectId),
        ...exceptions.filter((e) => e.entityType === "PROJECT").map((e) => e.entityId),
      ],
      donationIds: [
        ...entries.map((e) => e.donationId),
        ...exceptions.filter((e) => e.entityType === "DONATION").map((e) => e.entityId),
      ],
    });
  } catch {
    labels = EMPTY_LABELS;
  }

  const net = netAmount(
    totals.flatMap((t) =>
      t._sum.amount ? [{ direction: t.direction, amount: t._sum.amount }] : [],
    ),
  );
  const entryCount = totals.reduce((sum, t) => sum + t._count, 0);
  const severeCount = exceptions.filter((e) => SEVERE.includes(e.type)).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Finance</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
              Every confirmed payment, recorded once and never edited, plus everything that does
              not add up against it. This checks the platform against its own ledger — it does not
              talk to the bank, so it cannot tell you money was settled, only that our records
              agree with each other.
            </p>
          </div>
          <RunReconciliationButton />
        </div>

        {/* When was this last checked — an empty queue means nothing without it. */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          {!lastRun ? (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Reconciliation has never been run. An empty exception queue below proves nothing yet.
            </p>
          ) : lastRun.error ? (
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              The last run ({lastRun.startedAt.toLocaleString("en-IN")}) FAILED and did not finish
              checking. Treat the queue below as incomplete.
            </p>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Last checked <strong>{lastRun.startedAt.toLocaleString("en-IN")}</strong> —{" "}
              {lastRun.projectsChecked} projects, {lastRun.donorsChecked} donors,{" "}
              {lastRun.donationsChecked} confirmed donations. {lastRun.opened} new finding
              {lastRun.opened === 1 ? "" : "s"}, {lastRun.autoResolved} closed automatically.
            </p>
          )}
        </div>

        <div className="flex gap-3 flex-wrap">
          <span
            className={`px-3 py-1.5 rounded-full text-sm font-bold border ${
              severeCount > 0
                ? "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30"
                : "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30"
            }`}
          >
            {severeCount} money {severeCount === 1 ? "discrepancy" : "discrepancies"}
          </span>
          <span className="px-3 py-1.5 rounded-full text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
            {exceptions.length} open exception{exceptions.length === 1 ? "" : "s"}
          </span>
          <span className="px-3 py-1.5 rounded-full text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
            {rupees(net)} cash across {entryCount} {entryCount === 1 ? "entry" : "entries"}
          </span>
        </div>

        {/* ── Exceptions ────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
            Open exceptions
          </h2>
          {exceptions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-12 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {lastRun && !lastRun.error
                  ? "Everything the reconciler checks adds up."
                  : "Nothing recorded — run reconciliation to find out."}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {exceptions.map((exception) => (
                <li
                  key={exception.id}
                  className={`rounded-xl border bg-white dark:bg-gray-900 p-4 ${
                    SEVERE.includes(exception.type)
                      ? "border-red-200 dark:border-red-900/40"
                      : "border-gray-200 dark:border-gray-800"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">
                        {EXCEPTION_LABEL[exception.type]}
                      </p>
                      {(() => {
                        const subject = describeSubject(exception, labels);
                        if (!subject) return null;
                        return (
                          <p className="mt-0.5 text-sm font-medium text-gray-700 dark:text-gray-200">
                            {subject.line}
                            {subject.sub && (
                              <span className="text-gray-400 font-normal"> · {subject.sub}</span>
                            )}
                          </p>
                        );
                      })()}
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{exception.summary}</p>
                      {exception.entityType === "DONATION" ? (
                        <Link
                          href={`/admin/finance/donations/${exception.entityId}`}
                          className="mt-1 inline-block text-xs font-bold text-gray-600 dark:text-gray-300 underline underline-offset-2"
                        >
                          Open the full transaction →
                        </Link>
                      ) : null}
                      <p className="mt-1 text-xs text-gray-400 font-mono break-all">
                        {exception.entityType} {exception.entityId}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        First seen {exception.firstSeenAt.toLocaleDateString("en-IN")}
                        {exception.occurrences > 1 && ` · seen again ${exception.occurrences} times`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {exception.expectedAmount !== null && (
                        <p className="text-xs text-gray-400">
                          ledger {rupees(exception.expectedAmount)}
                        </p>
                      )}
                      {exception.observedAmount !== null && (
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          {rupees(exception.observedAmount)}
                        </p>
                      )}
                      {exception.entityType === "PROJECT" && (
                        <Link
                          href={`/admin/projects`}
                          className="text-xs font-bold text-gray-500 underline underline-offset-2"
                        >
                          Projects
                        </Link>
                      )}
                    </div>
                  </div>
                  <ResolveExceptionForm exceptionId={exception.id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Ledger ────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-gray-400 mb-3">
            Recent ledger entries
          </h2>
          {entries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-12 text-center">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                No money events recorded yet. Entries are written by the payment webhook when a
                payment is captured.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800">
                  <tr>
                    <th className="text-left font-bold px-4 py-3">Occurred</th>
                    <th className="text-left font-bold px-4 py-3">From</th>
                    <th className="text-left font-bold px-4 py-3">To</th>
                    <th className="text-left font-bold px-4 py-3">Type</th>
                    <th className="text-right font-bold px-4 py-3">Amount</th>
                    <th className="text-left font-bold px-4 py-3">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const project = entry.projectId ? labels.projects.get(entry.projectId) : undefined;
                    const donor = entry.donorId ? labels.donors.get(entry.donorId) : undefined;
                    return (
                    <tr key={entry.id} className="border-b last:border-0 border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                        <div>{entry.occurredAt.toLocaleDateString("en-IN")}</div>
                        <div className="text-xs text-gray-400">
                          {entry.occurredAt.toLocaleTimeString("en-IN")}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        {donor ?? (
                          <span className="font-mono text-xs text-gray-400">{shortId(entry.donorId)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {project ? (
                          <>
                            <div className="text-gray-900 dark:text-white">{project.orgName}</div>
                            <div className="text-xs text-gray-400">{project.title}</div>
                          </>
                        ) : (
                          <span className="font-mono text-xs text-gray-400">{shortId(entry.projectId)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">
                        {entry.entryType.replaceAll("_", " ").toLowerCase()}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold whitespace-nowrap ${
                          entry.direction === LedgerDirection.CREDIT
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-red-700 dark:text-red-400"
                        }`}
                      >
                        {entry.direction === LedgerDirection.CREDIT ? "+" : "−"}
                        {rupees(entry.amount)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 break-all">
                        {entry.donationId ? (
                          <Link
                            href={`/admin/finance/donations/${entry.donationId}`}
                            className="underline underline-offset-2 hover:text-gray-600 dark:hover:text-gray-200"
                          >
                            {entry.externalRef ?? entry.donationId}
                          </Link>
                        ) : (
                          entry.externalRef ?? "—"
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400">
            Ledger entries are immutable. A correction is recorded as a new, opposing entry —
            nothing here is ever edited or deleted. Open a reference to see the whole transaction:
            documents, evidence, and everything that happened to it.
          </p>
        </section>
      </div>
    </div>
  );
}
