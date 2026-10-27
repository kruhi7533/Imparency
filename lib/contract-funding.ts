import { Prisma, MilestoneFundingStatus, PaymentAllocationStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { Tx } from "@/lib/requirements/commit";
import { notifyProjectFunded, stampProjectFundedIfComplete } from "@/lib/project-funding";

/**
 * Contract payment → milestone allocation, and milestone / contract funding.
 *
 * ─── The allocation rule (documented, tested in tests/contract-funding.test.ts)
 *
 * Every contract payment is split into ContractPaymentAllocation lines, in the
 * SAME transaction that records it (contract row locked):
 *
 *  1. EXPLICIT — the donor chose a milestone: one line, the whole amount, on
 *     that milestone (checkRecordPayment already refused anything above the
 *     milestone's unpaid balance).
 *  2. AUTO_MILESTONE_ORDER — no milestone chosen: the amount fills milestones
 *     in delivery order (orderIndex, then createdAt, then id), each up to its
 *     un-allocated room (allocatedAmount minus lines already on it that still
 *     count). Whatever is left after the last milestone stays un-allocated on
 *     the payment and is shown as such — never pushed onto a milestone.
 *     Golden path: ₹10L then ₹12.5L across 4L/8L/8L/2.5L gives
 *     [M1 4L, M2 6L] and [M2 2L, M3 8L, M4 2.5L].
 *  3. ADMIN_MANUAL — an admin re-allocates what a rejection freed.
 *
 * A line "counts" unless it is REJECTED or its payment is DISPUTED. Automatic
 * allocation happens once per payment; a payment that already has lines is
 * never re-split, so an admin's rejection is not silently undone. Payments
 * recorded before this module existed (no lines at all) are backfilled by the
 * same rule the first time their contract is recalculated.
 *
 * ─── Funding is cash, and cash is RECONCILED money only
 *
 * A milestone's fundingStatus (UNFUNDED → PARTIALLY_FUNDED → FUNDED) is a
 * separate field from the payment's status and from the milestone's delivery
 * status. It is recalculated whenever money is reconciled (NGO confirmation,
 * bank-statement match, admin manual match) or an allocation is rejected /
 * re-allocated — never when a payment is merely recorded as pending.
 *
 * Admin approval of a line is the "allocated" figure: reconciled cash an admin
 * has signed off as belonging to that milestone. It does not gate fundingStatus
 * (the money has arrived either way); it gates what an admin has vouched for.
 */

type Amount = Prisma.Decimal | string | number;
const dec = (v: Amount) => new Prisma.Decimal(v.toString());
const ZERO = new Prisma.Decimal(0);

export type AllocationRule = "EXPLICIT" | "AUTO_MILESTONE_ORDER" | "ADMIN_MANUAL";

export interface MilestoneForAllocation {
  id: string;
  allocatedAmount: Amount;
  orderIndex: number;
  createdAt?: Date;
}

export interface AllocationLineRow {
  paymentId: string;
  contractMilestoneId: string;
  amount: Amount;
  status: PaymentAllocationStatus | string;
}

export interface PaymentForFunding {
  id: string;
  amount: Amount;
  status: string;
}

/** Delivery order — the order milestones are filled in. */
export function milestoneOrder<T extends MilestoneForAllocation & { id: string }>(milestones: T[]): T[] {
  return [...milestones].sort(
    (a, b) =>
      a.orderIndex - b.orderIndex ||
      (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

/** Lines that still count: not REJECTED, and their payment is not DISPUTED. */
export function countingLines<T extends AllocationLineRow>(lines: T[], payments: PaymentForFunding[]): T[] {
  const disputed = new Set(payments.filter((p) => p.status === "DISPUTED").map((p) => p.id));
  return lines.filter((l) => l.status !== "REJECTED" && !disputed.has(l.paymentId));
}

/** Allocated (counting) amount per milestone. */
export function allocatedByMilestone(lines: AllocationLineRow[]): Map<string, Prisma.Decimal> {
  const out = new Map<string, Prisma.Decimal>();
  for (const l of lines) out.set(l.contractMilestoneId, (out.get(l.contractMilestoneId) ?? ZERO).plus(dec(l.amount)));
  return out;
}

/**
 * Rule 2. `existing` must already be the counting lines (see countingLines).
 */
export function planAutoAllocation(
  milestones: MilestoneForAllocation[],
  existing: AllocationLineRow[],
  amount: Amount,
): { lines: Array<{ contractMilestoneId: string; amount: Prisma.Decimal }>; unallocated: Prisma.Decimal } {
  const used = allocatedByMilestone(existing);
  let left = dec(amount);
  const lines: Array<{ contractMilestoneId: string; amount: Prisma.Decimal }> = [];
  for (const m of milestoneOrder(milestones)) {
    if (left.lessThanOrEqualTo(0)) break;
    const room = dec(m.allocatedAmount).minus(used.get(m.id) ?? ZERO);
    if (room.lessThanOrEqualTo(0)) continue;
    const take = Prisma.Decimal.min(room, left);
    lines.push({ contractMilestoneId: m.id, amount: take });
    left = left.minus(take);
  }
  return { lines, unallocated: left };
}

export type ManualAllocationCheck = { ok: true; amount: Prisma.Decimal } | { ok: false; status: number; error: string };

/**
 * Rule 3 — an admin allocating (part of) a payment to a milestone by hand.
 * Over-allocation at either end is refused with 422: more than the payment has
 * un-allocated, or more than the milestone has room for.
 */
export function checkManualAllocation(args: {
  payment: { id: string; amount: Amount; status: string; contractId: string };
  milestone: { id: string; contractId: string; allocatedAmount: Amount };
  lines: AllocationLineRow[];
  payments: PaymentForFunding[];
  amount: unknown;
}): ManualAllocationCheck {
  const { payment, milestone } = args;
  if (milestone.contractId !== payment.contractId) {
    return { ok: false, status: 400, error: "That milestone belongs to a different contract than the payment." };
  }
  if (payment.status === "DISPUTED") {
    return { ok: false, status: 409, error: "A disputed payment cannot be allocated until the dispute is settled." };
  }
  let amount: Prisma.Decimal;
  try {
    if (typeof args.amount !== "string" && typeof args.amount !== "number") throw new Error();
    amount = dec(args.amount);
  } catch {
    return { ok: false, status: 400, error: "amount must be a number." };
  }
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0) || amount.decimalPlaces() > 2) {
    return { ok: false, status: 400, error: "amount must be greater than zero, with at most two decimal places." };
  }
  const counting = countingLines(args.lines, args.payments);
  const paymentUsed = counting.filter((l) => l.paymentId === payment.id).reduce((s, l) => s.plus(dec(l.amount)), ZERO);
  const paymentLeft = dec(payment.amount).minus(paymentUsed);
  if (amount.greaterThan(paymentLeft)) {
    return { ok: false, status: 422, error: `Over-allocation: only ₹${paymentLeft.toFixed(2)} of this payment is un-allocated.` };
  }
  const milestoneUsed = allocatedByMilestone(counting).get(milestone.id) ?? ZERO;
  const milestoneLeft = dec(milestone.allocatedAmount).minus(milestoneUsed);
  if (amount.greaterThan(milestoneLeft)) {
    return { ok: false, status: 422, error: `Over-allocation: this milestone has room for only ₹${milestoneLeft.toFixed(2)}.` };
  }
  return { ok: true, amount };
}

// ─── Per-milestone figures ───────────────────────────────────────────────────

export interface MilestoneFunding {
  id: string;
  /** What the contract commits to this milestone (a promise, not cash). */
  committed: string;
  /** Lines on payments still awaiting confirmation. */
  pending: string;
  /** Lines on RECONCILED payments — cash. */
  reconciled: string;
  /** Lines an admin APPROVED (on reconciled payments). */
  allocated: string;
  /** Committed minus reconciled — the receivable still expected. */
  outstanding: string;
  fundingStatus: MilestoneFundingStatus;
}

export function milestoneFundingStatus(committed: Amount, reconciled: Amount): MilestoneFundingStatus {
  const c = dec(committed);
  const r = dec(reconciled);
  if (r.lessThanOrEqualTo(0)) return MilestoneFundingStatus.UNFUNDED;
  if (r.lessThan(c)) return MilestoneFundingStatus.PARTIALLY_FUNDED;
  return MilestoneFundingStatus.FUNDED;
}

export function computeMilestoneFunding(
  milestones: Array<{ id: string; allocatedAmount: Amount }>,
  payments: PaymentForFunding[],
  lines: AllocationLineRow[],
): MilestoneFunding[] {
  const status = new Map(payments.map((p) => [p.id, p.status]));
  const counting = countingLines(lines, payments);
  return milestones.map((m) => {
    const mine = counting.filter((l) => l.contractMilestoneId === m.id);
    const sumWhere = (fn: (l: AllocationLineRow) => boolean) => mine.filter(fn).reduce((s, l) => s.plus(dec(l.amount)), ZERO);
    const pending = sumWhere((l) => status.get(l.paymentId) === "PENDING_CONFIRMATION");
    const reconciled = sumWhere((l) => status.get(l.paymentId) === "RECONCILED");
    const allocated = sumWhere((l) => status.get(l.paymentId) === "RECONCILED" && l.status === "APPROVED");
    const committed = dec(m.allocatedAmount);
    const outstanding = Prisma.Decimal.max(committed.minus(reconciled), ZERO);
    return {
      id: m.id,
      committed: committed.toFixed(2),
      pending: pending.toFixed(2),
      reconciled: reconciled.toFixed(2),
      allocated: allocated.toFixed(2),
      outstanding: outstanding.toFixed(2),
      fundingStatus: milestoneFundingStatus(committed, reconciled),
    };
  });
}

/** Un-allocated remainder per payment (counting lines only). */
export function unallocatedByPayment(payments: PaymentForFunding[], lines: AllocationLineRow[]): Map<string, Prisma.Decimal> {
  const counting = countingLines(lines, payments);
  const out = new Map<string, Prisma.Decimal>();
  for (const p of payments) {
    if (p.status === "DISPUTED") continue;
    const used = counting.filter((l) => l.paymentId === p.id).reduce((s, l) => s.plus(dec(l.amount)), ZERO);
    out.set(p.id, dec(p.amount).minus(used));
  }
  return out;
}

// ─── Inside a transaction ────────────────────────────────────────────────────

/** Serialise money changes on one contract (record, reconcile, allocate). */
export async function lockContract(tx: Tx, contractId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Contract" WHERE id = ${contractId} FOR UPDATE`;
}

/**
 * Writes the allocation lines for a payment just recorded (rules 1 and 2).
 * Call with the contract locked. `skipDuplicates` + the unique
 * (paymentId, contractMilestoneId) make a replay a no-op.
 */
export async function allocateNewPayment(
  tx: Tx,
  args: { contractId: string; paymentId: string; amount: Prisma.Decimal; milestoneId: string | null; actorId: string },
): Promise<Array<{ contractMilestoneId: string; amount: Prisma.Decimal }>> {
  let planned: Array<{ contractMilestoneId: string; amount: Prisma.Decimal }>;
  let rule: AllocationRule;
  if (args.milestoneId) {
    planned = [{ contractMilestoneId: args.milestoneId, amount: args.amount }];
    rule = "EXPLICIT";
  } else {
    const [milestones, lines, payments] = await Promise.all([
      tx.contractMilestone.findMany({
        where: { contractId: args.contractId },
        select: { id: true, allocatedAmount: true, orderIndex: true, createdAt: true },
      }),
      tx.contractPaymentAllocation.findMany({
        where: { contractId: args.contractId },
        select: { paymentId: true, contractMilestoneId: true, amount: true, status: true },
      }),
      tx.contractPayment.findMany({ where: { contractId: args.contractId }, select: { id: true, amount: true, status: true } }),
    ]);
    planned = planAutoAllocation(milestones, countingLines(lines, payments), args.amount).lines;
    rule = "AUTO_MILESTONE_ORDER";
  }
  if (planned.length > 0) {
    await tx.contractPaymentAllocation.createMany({
      data: planned.map((l) => ({
        paymentId: args.paymentId,
        contractId: args.contractId,
        contractMilestoneId: l.contractMilestoneId,
        amount: l.amount,
        rule,
        createdById: args.actorId,
      })),
      skipDuplicates: true,
    });
  }
  return planned;
}

export interface RecalcOutcome {
  /** Milestones that became FUNDED for the first time in this call. */
  newlyFundedMilestones: Array<{ id: string; title: string }>;
  contractNewlyFunded: boolean;
  projectNewlyFunded: boolean;
}

/**
 * Recomputes every milestone's fundingStatus from reconciled allocation lines,
 * stamps Contract.fundedAt / milestone fundedAt the first time each is funded
 * (compare-and-swap on null, so concurrent callers stamp — and notify — once),
 * and stamps the project. Backfills lines for legacy payments that have none.
 *
 * Call inside the transaction that reconciled money, AFTER the payment write.
 */
export async function recalcContractFunding(tx: Tx, contractId: string, now: Date = new Date()): Promise<RecalcOutcome> {
  await lockContract(tx, contractId);
  const contract = await tx.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      projectId: true,
      totalGrantAmount: true,
      fundedAt: true,
      milestones: {
        select: { id: true, title: true, allocatedAmount: true, orderIndex: true, createdAt: true, fundingStatus: true, fundedAt: true },
      },
      payments: { select: { id: true, amount: true, status: true, recordedAt: true, contractMilestoneId: true } },
      paymentAllocations: { select: { paymentId: true, contractMilestoneId: true, amount: true, status: true } },
    },
  });
  if (!contract) return { newlyFundedMilestones: [], contractNewlyFunded: false, projectNewlyFunded: false };

  const lines: AllocationLineRow[] = [...contract.paymentAllocations];

  // Backfill: payments recorded before allocation lines existed.
  const withLines = new Set(lines.map((l) => l.paymentId));
  const legacy = contract.payments
    .filter((p) => p.status !== "DISPUTED" && !withLines.has(p.id))
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  for (const p of legacy) {
    const planned = p.contractMilestoneId
      ? [{ contractMilestoneId: p.contractMilestoneId, amount: dec(p.amount) }]
      : planAutoAllocation(contract.milestones, countingLines(lines, contract.payments), p.amount).lines;
    const rule: AllocationRule = p.contractMilestoneId ? "EXPLICIT" : "AUTO_MILESTONE_ORDER";
    if (planned.length === 0) continue;
    await tx.contractPaymentAllocation.createMany({
      data: planned.map((l) => ({ paymentId: p.id, contractId, contractMilestoneId: l.contractMilestoneId, amount: l.amount, rule })),
      skipDuplicates: true,
    });
    for (const l of planned) lines.push({ paymentId: p.id, contractMilestoneId: l.contractMilestoneId, amount: l.amount, status: "PENDING_APPROVAL" });
  }

  const funding = computeMilestoneFunding(contract.milestones, contract.payments, lines);
  const newlyFundedMilestones: Array<{ id: string; title: string }> = [];
  for (const f of funding) {
    const m = contract.milestones.find((x) => x.id === f.id)!;
    if (m.fundingStatus !== f.fundingStatus) {
      await tx.contractMilestone.update({ where: { id: m.id }, data: { fundingStatus: f.fundingStatus } });
    }
    if (f.fundingStatus === MilestoneFundingStatus.FUNDED && !m.fundedAt) {
      const { count } = await tx.contractMilestone.updateMany({ where: { id: m.id, fundedAt: null }, data: { fundedAt: now } });
      if (count === 1) newlyFundedMilestones.push({ id: m.id, title: m.title });
    }
  }

  const reconciled = contract.payments.filter((p) => p.status === "RECONCILED").reduce((s, p) => s.plus(dec(p.amount)), ZERO);
  let contractNewlyFunded = false;
  if (!contract.fundedAt && reconciled.greaterThanOrEqualTo(dec(contract.totalGrantAmount)) && reconciled.greaterThan(0)) {
    const { count } = await tx.contract.updateMany({ where: { id: contractId, fundedAt: null }, data: { fundedAt: now } });
    contractNewlyFunded = count === 1;
    if (contractNewlyFunded) {
      await tx.contractAuditLog.create({
        data: {
          contractId,
          action: "CONTRACT_FUNDED",
          actorId: "SYSTEM",
          actorRole: "SYSTEM",
          detail: `Every committed rupee (₹${dec(contract.totalGrantAmount).toFixed(2)}) has been received and reconciled. Contract is FUNDED.`,
          metadata: { reconciled: reconciled.toFixed(2) },
        },
      });
    }
  }

  const projectNewlyFunded = await stampProjectFundedIfComplete(tx, contract.projectId, now);
  return { newlyFundedMilestones, contractNewlyFunded, projectNewlyFunded };
}

// ─── Donor notifications (DON-012) ──────────────────────────────────────────

/**
 * Tells the contract's donor that a milestone was funded (reconciled money
 * covers it) or completed (disbursed). Goes through the shared donor
 * dispatcher (lib/notification-dispatch.ts), so the donor's preferences apply:
 * project updates switched off (User.projectUpdatesOptOut) → OPTED_OUT, in-app
 * switched off → no in-app row; every attempt is logged per channel.
 *
 * Called after the transaction that stamped the event once (fundedAt / the
 * DISBURSED transition); the eventKey makes a re-fired event a no-op per
 * channel as a second guard. Best-effort: never throws into the money path.
 */
export async function notifyDonorMilestone(args: {
  contractId: string;
  milestones: Array<{ id: string; title: string }>;
  event: "FUNDED" | "COMPLETED";
}): Promise<number> {
  if (args.milestones.length === 0) return 0;
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: args.contractId },
      select: { donorId: true, projectId: true, contractNumber: true, project: { select: { title: true } } },
    });
    if (!contract) return 0;
    const { dispatchDonorNotification } = await import("@/lib/notification-dispatch");
    let reached = 0;
    for (const m of args.milestones) {
      const results = await dispatchDonorNotification({
        userId: contract.donorId,
        eventKey: `contract-milestone-${args.event === "FUNDED" ? "funded" : "completed"}:${m.id}`,
        topic: "PROJECT_UPDATE",
        title: args.event === "FUNDED" ? "Milestone fully funded" : "Milestone completed",
        body:
          args.event === "FUNDED"
            ? `Contract ${contract.contractNumber}: "${m.title}" is now fully funded with reconciled money.`
            : `Contract ${contract.contractNumber}: "${m.title}" has been completed and disbursed.`,
        link: `/donor/contracts/${args.contractId}`,
        projectTitle: contract.project?.title,
      });
      if (results.some((r) => r.status === "SENT")) reached++;
    }
    return reached;
  } catch (err) {
    console.error("[contract-funding] donor milestone notification failed:", err);
    return 0;
  }
}

/** Post-commit notifications for whatever a recalculation newly funded. */
export async function notifyAfterRecalc(contractId: string, funding: RecalcOutcome): Promise<void> {
  if (funding.newlyFundedMilestones.length) {
    await notifyDonorMilestone({ contractId, milestones: funding.newlyFundedMilestones, event: "FUNDED" });
  }
  if (funding.projectNewlyFunded) {
    const c = await prisma.contract.findUnique({ where: { id: contractId }, select: { projectId: true } });
    if (c) await notifyProjectFunded(c.projectId);
  }
}
