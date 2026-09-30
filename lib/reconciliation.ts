import { Prisma, FinanceExceptionType, LedgerDirection } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  autoResolveExceptions,
  recordException,
  type ExceptionFinding,
  type FinanceEntityType,
} from "@/lib/finance-exceptions";
import { captureError } from "@/lib/observability";
import { CASH_ENTRY_TYPES } from "@/lib/ledger";
import { confirmationCutoff, fundingState, paidTotal, CONFIRMATION_GRACE_DAYS } from "@/lib/allocation";

/**
 * Reconciliation: does what we say we hold match what we can prove we received?
 *
 * Deterministic, no model call - the same shape as lib/verification-triage.ts.
 * Every check compares a RUNNING COUNTER against a total DERIVED from the
 * append-only ledger, and every disagreement becomes a FinanceException.
 *
 * Deliberately NOT a bank reconciliation: nothing here talks to a settlement
 * API, so it cannot tell you that money reached the bank. It checks internal
 * consistency, which is the failure mode the platform actually has today
 * (increments applied twice, webhooks lost, payments with no donation row).
 * Statement-level matching belongs with payouts, which are deliberately last.
 */

/**
 * How long a donation may sit PENDING before it is a question worth asking.
 *
 * A checkout that is going to succeed does so in minutes and the webhook
 * follows within seconds. 24 hours is far past any legitimate delay, so a row
 * still PENDING after it means either an abandoned checkout (harmless, but
 * worth seeing in bulk) or a capture whose webhook never arrived (money taken,
 * nothing recorded). The reconciler cannot tell those apart - that is exactly
 * why a human is asked.
 */
export const STALE_PENDING_HOURS = 24;

/**
 * Amounts must agree to the paisa. There is no tolerance band on purpose: a
 * tolerance is a decision about how much money may go missing unnoticed, and
 * with Decimal arithmetic end to end there is no rounding drift to absorb.
 */
export function compareCounterToLedger(args: {
  type: FinanceExceptionType;
  entityType: FinanceEntityType;
  entityId: string;
  /** What the denormalised counter column says. */
  counter: Prisma.Decimal;
  /** What the ledger adds up to. */
  ledger: Prisma.Decimal;
}): ExceptionFinding | null {
  if (args.counter.equals(args.ledger)) return null;
  const delta = args.counter.minus(args.ledger);
  return {
    type: args.type,
    entityType: args.entityType,
    entityId: args.entityId,
    // Ids and amounts only.
    summary: `Counter ${args.counter.toFixed(2)} vs ledger ${args.ledger.toFixed(2)} (delta ${delta.toFixed(2)})`,
    expectedAmount: args.ledger,
    observedAmount: args.counter,
    detail: { delta: delta.toFixed(2), counterHigher: delta.greaterThan(0) },
  };
}

export function stalePendingCutoff(now: Date = new Date(), hours = STALE_PENDING_HOURS): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/**
 * Net per grouping key from a Prisma `groupBy` over (key, direction).
 *
 * Kept separate from the query so the sign handling - credits minus debits -
 * is testable without a database. A caller that summed `_sum.amount` across
 * both directions would quietly count a refund as income.
 */
export function netByKey<K extends string>(
  rows: Array<{ direction: LedgerDirection; _sum: { amount: Prisma.Decimal | null } } & Record<K, string | null>>,
  key: K,
): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    const id = row[key];
    if (!id) continue;
    const amount = row._sum.amount ?? new Prisma.Decimal(0);
    const running = out.get(id) ?? new Prisma.Decimal(0);
    out.set(id, row.direction === LedgerDirection.CREDIT ? running.plus(amount) : running.minus(amount));
  }
  return out;
}

export interface ReconciliationResult {
  runId: string;
  projectsChecked: number;
  donorsChecked: number;
  donationsChecked: number;
  opened: number;
  recurred: number;
  autoResolved: number;
  error?: string;
}

/**
 * Run every check and write the findings.
 *
 * Scale note: this loads all projects and all donors with money against them.
 * That is correct and cheap at pilot size (hundreds of rows) and will need
 * windowing - reconcile a date range, not the world - before it is pointed at
 * a real production table. Left simple rather than half-paginated, because a
 * reconciler that silently skips rows is worse than none.
 */
export async function runReconciliation(
  opts: { triggeredById?: string | null } = {},
): Promise<ReconciliationResult> {
  const run = await prisma.reconciliationRun.create({
    data: { triggeredById: opts.triggeredById ?? null },
    select: { id: true },
  });

  let opened = 0;
  let recurred = 0;
  let autoResolved = 0;
  let projectsChecked = 0;
  let donorsChecked = 0;
  let donationsChecked = 0;

  const apply = async (finding: ExceptionFinding) => {
    const outcome = await recordException(finding);
    if (outcome === "opened") opened += 1;
    else recurred += 1;
  };

  try {
    // 1. Project raised totals
    const [projects, projectSums] = await Promise.all([
      prisma.project.findMany({ select: { id: true, raisedAmount: true } }),
      // CASH ONLY. The ledger also carries commitments, which never moved
      // Project.raisedAmount — including them here would report every
      // allocation as drift. See CASH_ENTRY_TYPES.
      prisma.ledgerEntry.groupBy({
        by: ["projectId", "direction"],
        where: { entryType: { in: CASH_ENTRY_TYPES } },
        _sum: { amount: true },
      }),
    ]);
    const projectNet = netByKey(projectSums as never, "projectId");
    const balancedProjects: string[] = [];
    projectsChecked = projects.length;

    for (const project of projects) {
      const finding = compareCounterToLedger({
        type: FinanceExceptionType.PROJECT_TOTAL_MISMATCH,
        entityType: "PROJECT",
        entityId: project.id,
        counter: new Prisma.Decimal(project.raisedAmount?.toString() ?? "0"),
        ledger: projectNet.get(project.id) ?? new Prisma.Decimal(0),
      });
      if (finding) await apply(finding);
      else balancedProjects.push(project.id);
    }

    // 2. Donor lifetime totals
    const [donors, donorSums] = await Promise.all([
      prisma.user.findMany({
        where: { role: "DONOR" },
        select: { id: true, totalDonated: true },
      }),
      prisma.ledgerEntry.groupBy({
        by: ["donorId", "direction"],
        where: { entryType: { in: CASH_ENTRY_TYPES } },
        _sum: { amount: true },
      }),
    ]);
    const donorNet = netByKey(donorSums as never, "donorId");
    const balancedDonors: string[] = [];
    donorsChecked = donors.length;

    for (const donor of donors) {
      const finding = compareCounterToLedger({
        type: FinanceExceptionType.DONOR_TOTAL_MISMATCH,
        entityType: "DONOR",
        entityId: donor.id,
        counter: new Prisma.Decimal(donor.totalDonated?.toString() ?? "0"),
        ledger: donorNet.get(donor.id) ?? new Prisma.Decimal(0),
      });
      if (finding) await apply(finding);
      else balancedDonors.push(donor.id);
    }

    // 3. Confirmed donations with no ledger entry.
    // Every SUCCESS donation was confirmed by the webhook, which writes its
    // ledger entry in the same transaction. One without an entry means either
    // the row predates the ledger or something outside the webhook marked it
    // paid - both are worth a human look.
    const successful = await prisma.donation.findMany({
      where: { status: "SUCCESS" },
      select: { id: true, amount: true, projectId: true, razorpayPaymentId: true },
    });
    donationsChecked = successful.length;

    const entriesForDonations = successful.length
      ? await prisma.ledgerEntry.findMany({
          where: { donationId: { in: successful.map((d) => d.id) } },
          select: { donationId: true },
        })
      : [];
    const haveEntry = new Set(entriesForDonations.map((e) => e.donationId));
    const nowCovered: string[] = [];

    for (const donation of successful) {
      if (haveEntry.has(donation.id)) {
        nowCovered.push(donation.id);
        continue;
      }
      await apply({
        type: FinanceExceptionType.MISSING_LEDGER_ENTRY,
        entityType: "DONATION",
        entityId: donation.id,
        summary: `Donation marked SUCCESS for ${new Prisma.Decimal(donation.amount.toString()).toFixed(2)} with no ledger entry`,
        observedAmount: new Prisma.Decimal(donation.amount.toString()),
        detail: { projectId: donation.projectId, hasPaymentId: Boolean(donation.razorpayPaymentId) },
      });
    }

    // 4. Donations stuck PENDING
    const cutoff = stalePendingCutoff();
    const stale = await prisma.donation.findMany({
      where: { status: "PENDING", createdAt: { lt: cutoff } },
      select: { id: true, amount: true, projectId: true, createdAt: true },
    });

    for (const donation of stale) {
      const ageHours = Math.floor((Date.now() - donation.createdAt.getTime()) / 3_600_000);
      await apply({
        type: FinanceExceptionType.STALE_PENDING_DONATION,
        entityType: "DONATION",
        entityId: donation.id,
        summary: `Donation PENDING for ${ageHours}h (${new Prisma.Decimal(donation.amount.toString()).toFixed(2)})`,
        observedAmount: new Prisma.Decimal(donation.amount.toString()),
        detail: { projectId: donation.projectId, ageHours },
      });
    }

    // A stale-PENDING finding clears when the donation stops being PENDING,
    // which is exactly the set that is now SUCCESS.
    const nowSettled = successful.map((d) => d.id);

    // 5. Commitments nobody has confirmed as paid.
    // An allocation is a promise. Until this check existed, nothing asked
    // whether the promise was kept — an organisation could be planning work
    // against money that never arrived while the platform displayed the
    // commitment as though it had. That is the trust failure this catches.
    const overdue = await prisma.allocation.findMany({
      where: { status: "APPROVED", decidedAt: { lt: confirmationCutoff() } },
      select: {
        id: true,
        amount: true,
        ngoId: true,
        decidedAt: true,
        payments: { select: { amount: true } },
      },
    });

    const confirmedIds: string[] = [];
    for (const allocation of overdue) {
      const paid = paidTotal(allocation.payments);
      const state = fundingState(allocation.amount, paid);
      // FUNDED and OVERFUNDED both mean the money came. Overfunding is its own
      // problem, but not this one — flagging it here would say "unconfirmed"
      // about money that plainly arrived.
      if (state === "FUNDED" || state === "OVERFUNDED") {
        confirmedIds.push(allocation.id);
        continue;
      }
      const days = allocation.decidedAt
        ? Math.floor((Date.now() - allocation.decidedAt.getTime()) / 86_400_000)
        : CONFIRMATION_GRACE_DAYS;
      await apply({
        type: FinanceExceptionType.UNCONFIRMED_ALLOCATION,
        entityType: "ALLOCATION",
        entityId: allocation.id,
        summary: `Committed ${new Prisma.Decimal(allocation.amount.toString()).toFixed(2)} ${days} days ago, ${paid.toFixed(2)} confirmed as received`,
        expectedAmount: new Prisma.Decimal(allocation.amount.toString()),
        observedAmount: paid,
        detail: { ngoId: allocation.ngoId, days, state },
      });
    }

    // 6. Close what now balances.
    // UNMATCHED_PAYMENT is absent on purpose: nothing the reconciler can see
    // proves an orphaned payment was dealt with.
    autoResolved += await autoResolveExceptions(
      FinanceExceptionType.PROJECT_TOTAL_MISMATCH,
      balancedProjects,
      "Project total matched the ledger on a later reconciliation run",
    );
    autoResolved += await autoResolveExceptions(
      FinanceExceptionType.DONOR_TOTAL_MISMATCH,
      balancedDonors,
      "Donor total matched the ledger on a later reconciliation run",
    );
    autoResolved += await autoResolveExceptions(
      FinanceExceptionType.MISSING_LEDGER_ENTRY,
      nowCovered,
      "Ledger entry present on a later reconciliation run",
    );
    autoResolved += await autoResolveExceptions(
      FinanceExceptionType.STALE_PENDING_DONATION,
      nowSettled,
      "Donation is no longer PENDING",
    );
    autoResolved += await autoResolveExceptions(
      FinanceExceptionType.UNCONFIRMED_ALLOCATION,
      confirmedIds,
      "The committed money has since been confirmed as received",
    );

    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        projectsChecked,
        donorsChecked,
        donationsChecked,
        opened,
        recurred,
        autoResolved,
      },
    });

    return {
      runId: run.id,
      projectsChecked,
      donorsChecked,
      donationsChecked,
      opened,
      recurred,
      autoResolved,
    };
  } catch (err) {
    // A crashed run must never read as "clean". The row is completed with an
    // error so the finance page can say the last check did not finish.
    captureError(
      err,
      { scope: "reconciliation", operation: "run", entityType: "RECONCILIATION_RUN", entityId: run.id },
      "fatal",
    );
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        error: "Reconciliation run failed",
        opened,
        recurred,
        autoResolved,
      },
    });
    return {
      runId: run.id,
      projectsChecked,
      donorsChecked,
      donationsChecked,
      opened,
      recurred,
      autoResolved,
      error: "Reconciliation run failed",
    };
  }
}
