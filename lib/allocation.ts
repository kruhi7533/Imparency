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

/**
 * How long a commitment may go unconfirmed before it is a question worth
 * asking.
 *
 * An institutional transfer clears in days, not weeks; 30 allows for a funder
 * with a monthly disbursement cycle and a slow finance department. Past that,
 * either the money came and nobody recorded it, or it did not come — and an
 * organisation is planning work against a promise that is not being kept.
 * Neither answer is acceptable to leave invisible, which is why the finding
 * does not try to guess which one it is.
 */
export const CONFIRMATION_GRACE_DAYS = 30;

export type FundingState = "UNFUNDED" | "PARTIALLY_FUNDED" | "FUNDED" | "OVERFUNDED";

/** What has actually been confirmed as transferred against a commitment. */
export function paidTotal(
  payments: Array<{ amount: Prisma.Decimal | string | number }>,
): Prisma.Decimal {
  return payments.reduce(
    (sum, p) => sum.plus(new Prisma.Decimal(p.amount.toString())),
    new Prisma.Decimal(0),
  );
}

/**
 * Derived, never stored.
 *
 * A cached paid-total is one more counter that can drift from the evidence
 * behind it — the exact failure the ledger exists to catch. Recomputing from
 * the payment rows costs nothing at this scale and cannot be wrong.
 *
 * OVERFUNDED is a real state and not an error to swallow: more arriving than
 * was committed means either a duplicate confirmation or a funder who sent
 * too much, and both need a human.
 */
export function fundingState(
  committed: Prisma.Decimal | string | number,
  paid: Prisma.Decimal | string | number,
): FundingState {
  const c = new Prisma.Decimal(committed.toString());
  const p = new Prisma.Decimal(paid.toString());
  if (p.lessThanOrEqualTo(0)) return "UNFUNDED";
  if (p.lessThan(c)) return "PARTIALLY_FUNDED";
  if (p.equals(c)) return "FUNDED";
  return "OVERFUNDED";
}

export type PaymentRefusal =
  | "ALLOCATION_NOT_APPROVED"
  | "AMOUNT_NOT_POSITIVE"
  | "EXCEEDS_COMMITMENT"
  | "PAID_IN_THE_FUTURE";

export interface PaymentCheck {
  ok: boolean;
  refusal?: PaymentRefusal;
  message?: string;
}

/**
 * Whether a confirmation may be recorded against a commitment.
 *
 * Confirmations are only accepted against an APPROVED allocation: money
 * against a commitment nobody approved is money against nothing, and recording
 * it would create the appearance of funding for a decision that was never
 * taken.
 */
export function checkPayment(args: {
  allocationStatus: AllocationStatus;
  committed: Prisma.Decimal | string | number;
  alreadyPaid: Prisma.Decimal | string | number;
  amount: Prisma.Decimal | string | number;
  paidAt: Date;
  now?: Date;
}): PaymentCheck {
  if (args.allocationStatus !== AllocationStatus.APPROVED) {
    return {
      ok: false,
      refusal: "ALLOCATION_NOT_APPROVED",
      message: "Only an approved commitment can have money confirmed against it.",
    };
  }

  const amount = new Prisma.Decimal(args.amount.toString());
  if (amount.lessThanOrEqualTo(0)) {
    return { ok: false, refusal: "AMOUNT_NOT_POSITIVE", message: "Record an amount greater than zero." };
  }

  const now = args.now ?? new Date();
  if (args.paidAt.getTime() > now.getTime()) {
    // A transfer dated in the future is either a typo or a prediction. Both
    // would sit in the record as though the money had arrived.
    return {
      ok: false,
      refusal: "PAID_IN_THE_FUTURE",
      message: "A payment cannot be dated in the future.",
    };
  }

  const total = new Prisma.Decimal(args.alreadyPaid.toString()).plus(amount);
  const committed = new Prisma.Decimal(args.committed.toString());
  if (total.greaterThan(committed)) {
    const left = committed.minus(new Prisma.Decimal(args.alreadyPaid.toString()));
    return {
      ok: false,
      refusal: "EXCEEDS_COMMITMENT",
      message: `Only ${left.toFixed(2)} of this commitment is still unconfirmed. Recording more would claim the funder sent more than was committed — if they did, that needs looking at, not logging.`,
    };
  }

  return { ok: true };
}

/** Commitments this old with nothing confirmed are overdue. */
export function confirmationCutoff(now: Date = new Date(), days = CONFIRMATION_GRACE_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
