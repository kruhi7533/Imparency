import { Prisma, AllocationStatus, ProposalStatus } from "@prisma/client";

/**
 * The rules that decide whether money may be committed to a proposal, kept out
 * of the route so they can be tested without a request — the same shape as
 * lib/proposal-workflow.ts.
 *
 * An allocation is a COMMITMENT: it says a specific amount of an opportunity's
 * budget is spoken for. No money moves, nothing is requested from the funder,
 * and nothing is paid out. That distinction is the reason every refusal below
 * is about arithmetic and entitlement rather than about funds availability —
 * the platform is not holding this money and never claims to be.
 */

export type AllocationAction = "APPROVE" | "REJECT";

interface Transition {
  from: AllocationStatus;
  to: AllocationStatus;
  /** Past tense, for the audit trail. */
  logged: string;
}

export const ALLOCATION_TRANSITIONS: Record<AllocationAction, Transition> = {
  APPROVE: {
    from: AllocationStatus.PENDING,
    to: AllocationStatus.APPROVED,
    logged: "ALLOCATION_APPROVED",
  },
  REJECT: {
    from: AllocationStatus.PENDING,
    to: AllocationStatus.REJECTED,
    logged: "ALLOCATION_REJECTED",
  },
};

export function isAllocationAction(value: unknown): value is AllocationAction {
  return typeof value === "string" && value in ALLOCATION_TRANSITIONS;
}

/**
 * A rejection must say why. The organisation is told this reason, and a
 * refusal to commit money that gives none cannot be answered or appealed.
 */
export function requiresNote(action: AllocationAction): boolean {
  return action === "REJECT";
}

/**
 * Decided allocations are terminal. There is no un-approving: a commitment
 * that can be silently withdrawn is not a commitment, and an organisation
 * planning work against it would have no idea the ground had moved.
 *
 * A genuine change of mind is a new decision with its own record — today that
 * means rejecting the proposal, which is visible, rather than editing this row.
 */
export const TERMINAL_STATUSES: AllocationStatus[] = [
  AllocationStatus.APPROVED,
  AllocationStatus.REJECTED,
];

export function isTerminal(status: AllocationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * What is left of an opportunity's budget.
 *
 * Null budget is NOT treated as unlimited. An opportunity whose amount was
 * never recorded cannot have anything allocated against it, because every
 * "is there enough left" answer would be invented. Returning null here forces
 * the caller to say so rather than defaulting to a number.
 */
export function remainingBudget(
  budget: Prisma.Decimal | string | number | null | undefined,
  committed: Prisma.Decimal | string | number,
): Prisma.Decimal | null {
  if (budget === null || budget === undefined) return null;
  return new Prisma.Decimal(budget.toString()).minus(new Prisma.Decimal(committed.toString()));
}

export type AllocationRefusal =
  | "PROPOSAL_NOT_APPROVED"
  | "ALREADY_ALLOCATED"
  | "AMOUNT_NOT_POSITIVE"
  | "NO_BUDGET_RECORDED"
  | "EXCEEDS_REMAINING_BUDGET"
  | "EXCEEDS_REQUESTED_AMOUNT";

export interface AllocationCheck {
  ok: boolean;
  refusal?: AllocationRefusal;
  /** What to tell the admin. Written for a person, not for a log. */
  message?: string;
  remaining?: Prisma.Decimal | null;
}

/**
 * Every condition that must hold before money is committed, in one place.
 *
 * Run TWICE on the approval path: once when the allocation is proposed, and
 * again inside the transaction that approves it. The second run is not
 * redundant — budget is a shared resource, and two allocations drafted against
 * the same remaining ₹5L can both look affordable until one of them commits.
 */
export function checkAllocation(args: {
  proposalStatus: ProposalStatus;
  /** An existing allocation on this proposal, if any. */
  hasAllocation: boolean;
  /** The opportunity's total budget. Null when it was never recorded. */
  budget: Prisma.Decimal | string | number | null | undefined;
  /** Already committed against this opportunity, excluding this allocation. */
  committed: Prisma.Decimal | string | number;
  /** What this allocation wants to commit. */
  amount: Prisma.Decimal | string | number;
  /** What the organisation actually asked for. */
  requested: Prisma.Decimal | string | number;
}): AllocationCheck {
  if (args.proposalStatus !== ProposalStatus.APPROVED) {
    return {
      ok: false,
      refusal: "PROPOSAL_NOT_APPROVED",
      message:
        "Money can only be committed to an approved proposal. Approve the proposal first, so the decision to fund follows a decision to accept the plan.",
    };
  }

  if (args.hasAllocation) {
    return {
      ok: false,
      refusal: "ALREADY_ALLOCATED",
      message: "This proposal already has an allocation. A second one would be double-funding, not a correction.",
    };
  }

  const amount = new Prisma.Decimal(args.amount.toString());
  if (amount.lessThanOrEqualTo(0)) {
    return { ok: false, refusal: "AMOUNT_NOT_POSITIVE", message: "Commit an amount greater than zero." };
  }

  const requested = new Prisma.Decimal(args.requested.toString());
  if (amount.greaterThan(requested)) {
    return {
      ok: false,
      refusal: "EXCEEDS_REQUESTED_AMOUNT",
      // Under-funding a plan is a real decision. Over-funding one is funding
      // work nobody described.
      message: `This is more than the organisation asked for (${requested.toFixed(2)}). Commit that or less — funding above the proposal is money against a plan that was never reviewed.`,
    };
  }

  const remaining = remainingBudget(args.budget, args.committed);
  if (remaining === null) {
    return {
      ok: false,
      refusal: "NO_BUDGET_RECORDED",
      message:
        "This opportunity has no budget recorded, so there is nothing to commit against. Set its amount first.",
      remaining: null,
    };
  }

  if (amount.greaterThan(remaining)) {
    return {
      ok: false,
      refusal: "EXCEEDS_REMAINING_BUDGET",
      message: `Only ${remaining.toFixed(2)} is left of this opportunity's budget.`,
      remaining,
    };
  }

  return { ok: true, remaining };
}

/** Statuses that consume budget. A rejected allocation frees its amount again. */
export const COMMITTING_STATUSES: AllocationStatus[] = [
  AllocationStatus.PENDING,
  AllocationStatus.APPROVED,
];

/**
 * PENDING counts against the budget deliberately.
 *
 * A pending allocation is an admin's stated intent to commit. Leaving it out
 * would let a second allocation be drafted against budget the first one is
 * already claiming, and both would pass their own checks — the race would only
 * surface at approval, after both organisations had been told something.
 */
export function committedTotal(
  allocations: Array<{ status: AllocationStatus; amount: Prisma.Decimal | string | number }>,
): Prisma.Decimal {
  return allocations
    .filter((a) => COMMITTING_STATUSES.includes(a.status))
    .reduce((sum, a) => sum.plus(new Prisma.Decimal(a.amount.toString())), new Prisma.Decimal(0));
}
