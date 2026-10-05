import { Prisma, ContractPaymentMode, ContractPaymentStatus, ContractStatus, TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fundingState, type FundingState } from "@/lib/allocation";

/**
 * Week 6: money on the CSR contract track.
 *
 * A donor records a payment (SANDBOX or MANUAL — the platform moves no money)
 * against an ACTIVE contract the NGO has accepted. The NGO then confirms the
 * money arrived (RECONCILED) or disputes it (DISPUTED). Only reconciled money
 * counts as funded; a disputed payment counts toward nothing.
 *
 * Everything here except `resolveContractParty` is pure, so the rules can be
 * pinned in tests without a database.
 */

type Amount = Prisma.Decimal | string | number;
const dec = (v: Amount) => new Prisma.Decimal(v.toString());

// ─── Who is asking ───────────────────────────────────────────────────────────

export type ContractParty =
  | { party: "DONOR" }
  | { party: "NGO"; teamRole: TeamRole }
  | { party: "ADMIN" };

/**
 * Which side of this contract the caller is on, or null for a stranger.
 *
 * Role is not ownership (CLAUDE.md): a DONOR session must own the contract, and
 * an NGO session must own or be a team member of the contract's NGO. The NGO
 * owner is reported as OWNER so callers can check one field.
 */
export async function resolveContractParty(
  user: { id: string; role: string },
  contract: { donorId: string; ngoId: string },
): Promise<ContractParty | null> {
  if (user.role === "ADMIN") return { party: "ADMIN" };
  if (user.role === "DONOR") return contract.donorId === user.id ? { party: "DONOR" } : null;
  if (user.role !== "NGO") return null;

  const owned = await prisma.nGOProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (owned) return owned.id === contract.ngoId ? { party: "NGO", teamRole: TeamRole.OWNER } : null;

  const membership = await prisma.nGOTeamMember.findFirst({
    where: { userId: user.id, ngoId: contract.ngoId },
    select: { role: true },
  });
  return membership ? { party: "NGO", teamRole: membership.role } : null;
}

/** Accepting a funded project commits the organisation — owners and admins only. */
export const CAN_ACCEPT: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN];
/** Confirming money arrived is a finance act — FIELD_STAFF cannot. */
export const CAN_CONFIRM_PAYMENT: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN, TeamRole.FINANCE];

// ─── Accepting the funded project ────────────────────────────────────────────

export type AcceptCheck =
  | { ok: true; alreadyAccepted: boolean }
  | { ok: false; status: number; error: string };

export function checkAccept(contract: { status: ContractStatus; ngoAcceptedAt: Date | null }): AcceptCheck {
  if (contract.ngoAcceptedAt) return { ok: true, alreadyAccepted: true };
  if (contract.status !== ContractStatus.ACTIVE) {
    return {
      ok: false,
      status: 409,
      error: `Only an ACTIVE contract (signed by both parties) can be accepted; this one is ${contract.status}.`,
    };
  }
  return { ok: true, alreadyAccepted: false };
}

// ─── Recording a payment ─────────────────────────────────────────────────────

export interface PaymentRow {
  id?: string;
  amount: Amount;
  status: ContractPaymentStatus;
  contractMilestoneId: string | null;
}

/** Payments that still count toward a balance. A disputed one does not. */
export function countedPayments<T extends PaymentRow>(payments: T[]): T[] {
  return payments.filter((p) => p.status !== ContractPaymentStatus.DISPUTED);
}

function sum(payments: PaymentRow[]): Prisma.Decimal {
  return payments.reduce((acc, p) => acc.plus(dec(p.amount)), new Prisma.Decimal(0));
}

export function isPaymentMode(v: unknown): v is ContractPaymentMode {
  return v === ContractPaymentMode.SANDBOX || v === ContractPaymentMode.MANUAL;
}

export type RecordCheck =
  | { ok: true; amount: Prisma.Decimal }
  | { ok: false; status: number; error: string };

export function checkRecordPayment(args: {
  contract: { status: ContractStatus; ngoAcceptedAt: Date | null; totalGrantAmount: Amount };
  /** Null when the payment is not tied to a milestone. */
  milestone: { id: string; contractId: string; allocatedAmount: Amount } | null;
  contractId: string;
  payments: PaymentRow[];
  amount: unknown;
  mode: unknown;
  reference: unknown;
}): RecordCheck {
  const { contract, milestone } = args;

  if (contract.status !== ContractStatus.ACTIVE) {
    return { ok: false, status: 409, error: `Payments can only be recorded on an ACTIVE contract; this one is ${contract.status}.` };
  }
  if (!contract.ngoAcceptedAt) {
    return { ok: false, status: 409, error: "The NGO has not accepted this funded project yet." };
  }
  if (!isPaymentMode(args.mode)) {
    return { ok: false, status: 400, error: "mode must be SANDBOX or MANUAL." };
  }
  if (args.mode === ContractPaymentMode.MANUAL && (typeof args.reference !== "string" || !args.reference.trim())) {
    return { ok: false, status: 400, error: "A manual payment needs a reference (UTR or cheque number) to be reconciled." };
  }

  let amount: Prisma.Decimal;
  try {
    if (typeof args.amount !== "string" && typeof args.amount !== "number") throw new Error();
    amount = dec(args.amount);
  } catch {
    return { ok: false, status: 400, error: "amount must be a number." };
  }
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    return { ok: false, status: 400, error: "amount must be greater than zero." };
  }
  if (amount.decimalPlaces() > 2) {
    return { ok: false, status: 400, error: "amount can have at most two decimal places." };
  }

  const counted = countedPayments(args.payments);
  const contractRemaining = dec(contract.totalGrantAmount).minus(sum(counted));
  if (amount.greaterThan(contractRemaining)) {
    return {
      ok: false,
      status: 422,
      error: `This would exceed the contract. Unpaid balance is ₹${contractRemaining.toFixed(2)}.`,
    };
  }

  if (milestone) {
    if (milestone.contractId !== args.contractId) {
      return { ok: false, status: 400, error: "That milestone does not belong to this contract." };
    }
    const milestonePaid = sum(counted.filter((p) => p.contractMilestoneId === milestone.id));
    const milestoneRemaining = dec(milestone.allocatedAmount).minus(milestonePaid);
    if (amount.greaterThan(milestoneRemaining)) {
      return {
        ok: false,
        status: 422,
        error: `This would exceed the milestone allocation. Unpaid balance is ₹${milestoneRemaining.toFixed(2)}.`,
      };
    }
  }

  return { ok: true, amount };
}

/** A recognisable, non-guessable reference for a simulated transfer. */
export function sandboxReference(idempotencyKey: string): string {
  return `SANDBOX-${idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12).toUpperCase()}`;
}

// ─── NGO confirms or disputes ────────────────────────────────────────────────

export type PaymentDecision = "CONFIRM" | "DISPUTE";

export function isPaymentDecision(v: unknown): v is PaymentDecision {
  return v === "CONFIRM" || v === "DISPUTE";
}

export const DECISION_TARGET: Record<PaymentDecision, ContractPaymentStatus> = {
  CONFIRM: ContractPaymentStatus.RECONCILED,
  DISPUTE: ContractPaymentStatus.DISPUTED,
};

export type DecisionCheck =
  | { ok: true; noop: boolean; target: ContractPaymentStatus }
  | { ok: false; status: number; error: string };

/**
 * PENDING_CONFIRMATION is the only state a decision leaves. Repeating the same
 * decision is a no-op (a double-click, a retried request); a different
 * decision on an already-decided payment is a conflict, because reversing a
 * reconciliation is an admin's call, not a click.
 */
export function checkDecision(current: ContractPaymentStatus, decision: PaymentDecision, note: unknown): DecisionCheck {
  const target = DECISION_TARGET[decision];
  if (current === target) return { ok: true, noop: true, target };
  if (current !== ContractPaymentStatus.PENDING_CONFIRMATION) {
    return { ok: false, status: 409, error: `This payment is already ${current}.` };
  }
  if (decision === "DISPUTE" && (typeof note !== "string" || note.trim().length < 5)) {
    return { ok: false, status: 400, error: "Say what is wrong with the payment (at least 5 characters)." };
  }
  return { ok: true, noop: false, target };
}

// ─── What the cockpit and contract page show ─────────────────────────────────

export interface FundingSummary {
  committed: string;
  /** Recorded by the donor and not disputed (pending + reconciled). */
  recorded: string;
  reconciled: string;
  pending: string;
  disputed: string;
  /** From RECONCILED money only — a claim of payment is not funding. */
  state: FundingState;
  milestones: Array<{ id: string; allocated: string; reconciled: string; pending: string; state: FundingState }>;
}

export function fundingSummary(
  contract: { totalGrantAmount: Amount },
  milestones: Array<{ id: string; allocatedAmount: Amount }>,
  payments: PaymentRow[],
): FundingSummary {
  const by = (status: ContractPaymentStatus, list = payments) => sum(list.filter((p) => p.status === status));
  const reconciled = by(ContractPaymentStatus.RECONCILED);
  const pending = by(ContractPaymentStatus.PENDING_CONFIRMATION);

  return {
    committed: dec(contract.totalGrantAmount).toFixed(2),
    recorded: reconciled.plus(pending).toFixed(2),
    reconciled: reconciled.toFixed(2),
    pending: pending.toFixed(2),
    disputed: by(ContractPaymentStatus.DISPUTED).toFixed(2),
    state: fundingState(contract.totalGrantAmount, reconciled),
    milestones: milestones.map((m) => {
      const mine = payments.filter((p) => p.contractMilestoneId === m.id);
      const r = by(ContractPaymentStatus.RECONCILED, mine);
      return {
        id: m.id,
        allocated: dec(m.allocatedAmount).toFixed(2),
        reconciled: r.toFixed(2),
        pending: by(ContractPaymentStatus.PENDING_CONFIRMATION, mine).toFixed(2),
        state: fundingState(m.allocatedAmount, r),
      };
    }),
  };
}

// ─── Server → client props for the funding panel ─────────────────────────────

/**
 * Serialises a contract's funding for ContractPaymentsPanel. Amounts become
 * numbers only at this display edge; every rule above stays in Decimal.
 */
export function fundingPanelProps(
  contract: {
    id: string;
    status: ContractStatus;
    ngoAcceptedAt: Date | null;
    totalGrantAmount: Amount;
    milestones: Array<{ id: string; title: string; allocatedAmount: Amount }>;
    payments: Array<{
      id: string;
      amount: Amount;
      mode: ContractPaymentMode;
      reference: string | null;
      paidAt: Date;
      note: string | null;
      status: ContractPaymentStatus;
      disputeNote: string | null;
      contractMilestoneId: string | null;
    }>;
  },
  party: ContractParty,
) {
  const teamRole = party.party === "NGO" ? party.teamRole : null;
  const { milestones: perMilestone, ...summary } = fundingSummary(contract, contract.milestones, contract.payments);
  return {
    contractId: contract.id,
    contractStatus: contract.status,
    ngoAcceptedAt: contract.ngoAcceptedAt ? contract.ngoAcceptedAt.toISOString() : null,
    viewer: {
      party: party.party,
      canAccept: teamRole !== null && CAN_ACCEPT.includes(teamRole),
      canConfirm: teamRole !== null && CAN_CONFIRM_PAYMENT.includes(teamRole),
    },
    milestones: contract.milestones.map((m) => ({ id: m.id, title: m.title, allocatedAmount: Number(m.allocatedAmount.toString()) })),
    payments: [...contract.payments]
      .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())
      .map((p) => ({
        id: p.id,
        amount: Number(p.amount.toString()),
        mode: p.mode,
        reference: p.reference,
        paidAt: p.paidAt.toISOString(),
        note: p.note,
        status: p.status,
        disputeNote: p.disputeNote,
        contractMilestoneId: p.contractMilestoneId,
      })),
    summary,
    /** Per contract milestone, from reconciled money only. */
    milestoneStates: Object.fromEntries(perMilestone.map((m) => [m.id, m.state])) as Record<string, FundingState>,
  };
}
