import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { FinanceExceptionStatus, FinanceExceptionType, LedgerDirection } from "@prisma/client";
import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import SchemaOutOfSync from "@/app/admin/components/SchemaOutOfSync";
import { netAmount } from "@/lib/ledger";
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
];

function rupees(value: { toString(): string } | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${Number(value.toString()).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      prisma.ledgerEntry.groupBy({ by: ["direction"], _sum: { amount: true }, _count: true }),
    ]);
  } catch (err: any) {
    if (err?.code === "P2021" || err?.code === "P2022") {
      return <SchemaOutOfSync title="Finance view failed to load" detail={err?.meta?.table || err?.message} />;
    }
    throw err;
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
            {severeCount} unaccounted-for {severeCount === 1 ? "payment" : "payments"}
          </span>
          <span className="px-3 py-1.5 rounded-full text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
            {exceptions.length} open exception{exceptions.length === 1 ? "" : "s"}
          </span>
          <span className="px-3 py-1.5 rounded-full text-sm font-bold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
            {rupees(net)} across {entryCount} ledger {entryCount === 1 ? "entry" : "entries"}
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
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{exception.summary}</p>
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
                    <th className="text-left font-bold px-4 py-3">Type</th>
                    <th className="text-right font-bold px-4 py-3">Amount</th>
                    <th className="text-left font-bold px-4 py-3">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0 border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {entry.occurredAt.toLocaleString("en-IN")}
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
                        {entry.externalRef ?? entry.donationId ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-400">
            Ledger entries are immutable. A correction is recorded as a new, opposing entry —
            nothing here is ever edited or deleted.
          </p>
        </section>
      </div>
    </div>
  );
}
