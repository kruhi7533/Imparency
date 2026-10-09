import { OutcomeClaimStatus } from "@prisma/client";

/**
 * The outcome-claim state machine.
 *
 * Same shape as lib/grievance-workflow.ts and lib/proposal-workflow.ts: a
 * closed set of actions, each legal from an explicit set of statuses, applied
 * as a compare-and-swap so two admins deciding at once cannot both win.
 *
 *     DRAFT -> SUBMITTED -> APPROVED
 *                   |  ^        |
 *                   |  |        +-> WITHDRAWN
 *                   |  +-- (NGO resubmits)
 *                   +-> NEEDS_EVIDENCE -> SUBMITTED
 *                   +-> REJECTED
 *
 * Two properties this encodes that matter more than the diagram:
 *
 * 1. **APPROVED is not editable, only withdrawable.** A number that has been
 *    approved has been shown to a funder. Letting it be edited in place means a
 *    figure in someone's board report can change with no trace, which is the
 *    precise failure this whole module exists to prevent. The only way out is
 *    WITHDRAWN, with a note, and a fresh claim supersedes it.
 *
 * 2. **NEEDS_EVIDENCE is a return, not a rejection.** The common case is not
 *    fraud, it is a claim citing something that had not been approved in
 *    evidence review yet. That deserves "add the citation and resubmit", not a
 *    permanent REJECTED on the organisation's record. REJECTED is for a number
 *    that should not be reported at all.
 */

export type OutcomeAction = "SUBMIT" | "APPROVE" | "REQUEST_EVIDENCE" | "REJECT" | "WITHDRAW";

interface Transition {
  /** Every status this action may be applied from. */
  from: OutcomeClaimStatus[];
  to: OutcomeClaimStatus;
}

export const OUTCOME_TRANSITIONS: Record<OutcomeAction, Transition> = {
  // The NGO's own action. Legal from DRAFT and from NEEDS_EVIDENCE, which is
  // what makes the return loop work.
  SUBMIT: {
    from: [OutcomeClaimStatus.DRAFT, OutcomeClaimStatus.NEEDS_EVIDENCE],
    to: OutcomeClaimStatus.SUBMITTED,
  },
  APPROVE: {
    from: [OutcomeClaimStatus.SUBMITTED],
    to: OutcomeClaimStatus.APPROVED,
  },
  REQUEST_EVIDENCE: {
    from: [OutcomeClaimStatus.SUBMITTED],
    to: OutcomeClaimStatus.NEEDS_EVIDENCE,
  },
  REJECT: {
    from: [OutcomeClaimStatus.SUBMITTED],
    to: OutcomeClaimStatus.REJECTED,
  },
  // The only exit from APPROVED. Deliberately also legal from SUBMITTED, so an
  // organisation that spots its own error can pull the claim back before a
  // human spends time on it.
  WITHDRAW: {
    from: [OutcomeClaimStatus.SUBMITTED, OutcomeClaimStatus.APPROVED],
    to: OutcomeClaimStatus.WITHDRAWN,
  },
};

export const OUTCOME_ACTIONS = Object.keys(OUTCOME_TRANSITIONS) as OutcomeAction[];

export function isOutcomeAction(value: unknown): value is OutcomeAction {
  // hasOwnProperty, NOT `in`. `in` walks the prototype chain, so "toString"
  // and "constructor" would pass the guard and then index the table to a
  // function, giving a transition whose `from` is undefined. This exact
  // two-line hazard was found in isGrievanceAction during Week 7 and is pinned
  // by a test here rather than left to be re-read.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OUTCOME_TRANSITIONS, value);
}

/** Which actions only an admin may take. SUBMIT and WITHDRAW belong to the NGO. */
export const ADMIN_ONLY_ACTIONS: OutcomeAction[] = ["APPROVE", "REQUEST_EVIDENCE", "REJECT"];

export function isAdminOnly(action: OutcomeAction): boolean {
  return ADMIN_ONLY_ACTIONS.includes(action);
}

/**
 * Terminal states.
 *
 * REJECTED and WITHDRAWN are final; APPROVED is NOT, because WITHDRAW must
 * stay available to it. So "terminal" here means "no action at all applies",
 * which is true of exactly these two.
 */
export const TERMINAL_OUTCOME_STATUSES: OutcomeClaimStatus[] = [
  OutcomeClaimStatus.REJECTED,
  OutcomeClaimStatus.WITHDRAWN,
];

export function isTerminal(status: OutcomeClaimStatus): boolean {
  return TERMINAL_OUTCOME_STATUSES.includes(status);
}

export function canApply(action: OutcomeAction, current: OutcomeClaimStatus): boolean {
  return OUTCOME_TRANSITIONS[action].from.includes(current);
}

/**
 * Which actions require a written reason.
 *
 * Every adverse or reversing decision does. A rejection the organisation
 * cannot answer, a return with no statement of what is missing, or a
 * withdrawal of a number already reported with no account of why, are each
 * indistinguishable from the decision never having been explained. Same
 * position as a dismissed grievance, a rejected proposal and a rejected
 * allocation.
 *
 * APPROVE does not: the claim, its citations and the triage findings already
 * record what was approved and on what basis.
 */
export function requiresNote(action: OutcomeAction): boolean {
  return action === "REJECT" || action === "REQUEST_EVIDENCE" || action === "WITHDRAW";
}

/**
 * Only a number that is still only a number may be edited.
 *
 * Once SUBMITTED, an admin may be looking at it; once APPROVED, a funder may
 * be. Editing value/method/citations is therefore confined to DRAFT and
 * NEEDS_EVIDENCE — the two states where the claim is in the organisation's
 * hands.
 */
export function isEditable(status: OutcomeClaimStatus): boolean {
  return status === OutcomeClaimStatus.DRAFT || status === OutcomeClaimStatus.NEEDS_EVIDENCE;
}

/** Whether a claim's value may appear as a number in a donor-facing report. */
export function countsTowardReportedImpact(status: OutcomeClaimStatus): boolean {
  return status === OutcomeClaimStatus.APPROVED;
}

/** Why this action cannot be applied from this status, in the actor's words. */
export function explainRefusal(action: OutcomeAction, current: OutcomeClaimStatus): string {
  const readable = (s: OutcomeClaimStatus) => s.toLowerCase().replace(/_/g, " ");

  if (isTerminal(current)) {
    return `This claim was already ${readable(current)} and cannot be changed. A corrected figure has to be filed as a new claim.`;
  }

  if (action === "APPROVE" && current === OutcomeClaimStatus.APPROVED) {
    return "This claim is already approved.";
  }

  if (current === OutcomeClaimStatus.APPROVED) {
    return (
      "This claim is approved, so the figure may already have reached a funder. It cannot be " +
      "edited or re-decided — withdraw it with a reason and file a corrected claim."
    );
  }

  if (action === "SUBMIT" && current === OutcomeClaimStatus.SUBMITTED) {
    return "This claim has already been submitted and is waiting for review.";
  }

  const allowed = OUTCOME_TRANSITIONS[action].from.map(readable).join(" or ");
  return `This action needs the claim to be ${allowed}; it is ${readable(current)}.`;
}
