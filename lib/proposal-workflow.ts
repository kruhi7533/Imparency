import { ProposalStatus } from "@prisma/client";

/**
 * The proposal state machine, kept out of the route so the legal moves can be
 * tested without a request.
 *
 * Shape borrowed deliberately from the opportunity lifecycle in
 * app/api/admin/matching/opportunities/[id]/route.ts: a closed set of actions,
 * each with the single status it may be applied from, executed as a
 * compare-and-swap so two admins acting at once cannot both win.
 */

export type ProposalAction = "START_REVIEW" | "APPROVE" | "REJECT";

interface Transition {
  from: ProposalStatus;
  to: ProposalStatus;
  /** Past tense, for the audit trail. */
  logged: string;
}

export const PROPOSAL_TRANSITIONS: Record<ProposalAction, Transition> = {
  START_REVIEW: {
    from: ProposalStatus.SUBMITTED,
    to: ProposalStatus.UNDER_REVIEW,
    logged: "PROPOSAL_REVIEW_STARTED",
  },
  APPROVE: {
    from: ProposalStatus.UNDER_REVIEW,
    to: ProposalStatus.APPROVED,
    logged: "PROPOSAL_APPROVED",
  },
  REJECT: {
    from: ProposalStatus.UNDER_REVIEW,
    to: ProposalStatus.REJECTED,
    logged: "PROPOSAL_REJECTED",
  },
};

export const PROPOSAL_ACTIONS = Object.keys(PROPOSAL_TRANSITIONS) as ProposalAction[];

export function isProposalAction(value: unknown): value is ProposalAction {
  return typeof value === "string" && value in PROPOSAL_TRANSITIONS;
}

/**
 * Terminal states. A decided proposal never moves again — reopening one would
 * make "approved" a claim with no fixed meaning, and the funded project built
 * from it would have no stable basis.
 */
export const TERMINAL_PROPOSAL_STATUSES: ProposalStatus[] = [
  ProposalStatus.APPROVED,
  ProposalStatus.REJECTED,
  ProposalStatus.WITHDRAWN,
];

export function isTerminal(status: ProposalStatus): boolean {
  return TERMINAL_PROPOSAL_STATUSES.includes(status);
}

/** Why this action cannot be applied from this status, in the admin's words. */
export function explainRefusal(action: ProposalAction, current: ProposalStatus): string {
  const { from } = PROPOSAL_TRANSITIONS[action];
  if (isTerminal(current)) {
    return `This proposal is already ${current.toLowerCase()} and cannot be changed.`;
  }
  return `A proposal must be ${from.toLowerCase().replace(/_/g, " ")} before it can be ${
    action === "START_REVIEW" ? "taken up for review" : `${action.toLowerCase()}d`
  }; this one is ${current.toLowerCase().replace(/_/g, " ")}.`;
}

/**
 * A rejection must say why.
 *
 * The organisation is told the outcome, and "no" with no reason is not
 * something a person can act on or appeal.
 */
export function requiresNote(action: ProposalAction): boolean {
  return action === "REJECT";
}
