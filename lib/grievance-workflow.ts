import { GrievanceStatus } from "@prisma/client";

/**
 * The grievance state machine.
 *
 * Same shape as lib/proposal-workflow.ts and the opportunity lifecycle: a
 * closed set of actions, each legal from exactly one status, applied as a
 * compare-and-swap so two admins acting at once cannot both win.
 *
 * The chain is deliberately longer than it needs to be:
 *
 *     OPEN -> TRIAGED -> INVESTIGATING -> RESOLVED | DISMISSED
 *
 * In particular a complaint cannot be DISMISSED straight out of the queue. It
 * has to be triaged (someone judged how serious it is) and investigated
 * (someone looked) first. Allowing a one-click dismissal from OPEN would make
 * the cheapest possible action also the one that ends the complaint, which is
 * exactly how a redress channel becomes decorative.
 */

export type GrievanceAction = "TRIAGE" | "START_INVESTIGATION" | "RESOLVE" | "DISMISS";

interface Transition {
  from: GrievanceStatus;
  to: GrievanceStatus;
  /** Past tense, for the audit trail. */
  logged: "GRIEVANCE_TRIAGED" | "GRIEVANCE_INVESTIGATION_STARTED" | "GRIEVANCE_RESOLVED" | "GRIEVANCE_DISMISSED";
}

export const GRIEVANCE_TRANSITIONS: Record<GrievanceAction, Transition> = {
  TRIAGE: {
    from: GrievanceStatus.OPEN,
    to: GrievanceStatus.TRIAGED,
    logged: "GRIEVANCE_TRIAGED",
  },
  START_INVESTIGATION: {
    from: GrievanceStatus.TRIAGED,
    to: GrievanceStatus.INVESTIGATING,
    logged: "GRIEVANCE_INVESTIGATION_STARTED",
  },
  RESOLVE: {
    from: GrievanceStatus.INVESTIGATING,
    to: GrievanceStatus.RESOLVED,
    logged: "GRIEVANCE_RESOLVED",
  },
  DISMISS: {
    from: GrievanceStatus.INVESTIGATING,
    to: GrievanceStatus.DISMISSED,
    logged: "GRIEVANCE_DISMISSED",
  },
};

export const GRIEVANCE_ACTIONS = Object.keys(GRIEVANCE_TRANSITIONS) as GrievanceAction[];

export function isGrievanceAction(value: unknown): value is GrievanceAction {
  // hasOwnProperty, NOT `in`. `in` walks the prototype chain, so `"toString"`
  // and `"constructor"` would both pass the guard and then index the table to
  // a function — giving a transition whose `from` is undefined. Caught by a
  // test rather than by reading.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GRIEVANCE_TRANSITIONS, value);
}

/**
 * Terminal states. A closed complaint never reopens.
 *
 * If the same problem is still happening, the reporter files again — and a
 * second complaint about a thing someone already called resolved is itself
 * the signal worth seeing. Reopening in place would erase that.
 */
export const TERMINAL_GRIEVANCE_STATUSES: GrievanceStatus[] = [
  GrievanceStatus.RESOLVED,
  GrievanceStatus.DISMISSED,
];

export function isTerminal(status: GrievanceStatus): boolean {
  return TERMINAL_GRIEVANCE_STATUSES.includes(status);
}

/**
 * Severity is set once, at triage, by a human.
 *
 * Not on intake by the reporter: a self-selected severity is CRITICAL on every
 * row within a week. Not automatically from the category either — SAFEGUARDING
 * is usually the most serious kind, but "usually" is not a basis for ranking a
 * specific person's complaint above another's.
 */
export function requiresSeverity(action: GrievanceAction): boolean {
  return action === "TRIAGE";
}

/**
 * Both ways of closing a complaint need a written reason.
 *
 * The finance-exception route takes the same position for the same reason: a
 * resolution with no account of what was done is indistinguishable from
 * silence. Dismissal is the more important of the two — it is the one the
 * reporter will want to argue with.
 */
export function requiresNote(action: GrievanceAction): boolean {
  return action === "RESOLVE" || action === "DISMISS";
}

/** Why this action cannot be applied from this status, in the admin's words. */
export function explainRefusal(action: GrievanceAction, current: GrievanceStatus): string {
  const { from } = GRIEVANCE_TRANSITIONS[action];

  if (isTerminal(current)) {
    return `This grievance was already ${current.toLowerCase()} and cannot be changed. If the problem is ongoing, it needs a new report.`;
  }

  const readable = (s: GrievanceStatus) => s.toLowerCase().replace(/_/g, " ");

  if (action === "DISMISS" || action === "RESOLVE") {
    return `A grievance must be under investigation before it can be ${
      action === "DISMISS" ? "dismissed" : "resolved"
    }; this one is ${readable(current)}. Someone has to look at it first.`;
  }

  return `This action needs the grievance to be ${readable(from)}; it is ${readable(current)}.`;
}
