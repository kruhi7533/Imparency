/**
 * How long each queue is allowed to keep someone waiting.
 *
 * Until now these numbers existed, but only as magic thresholds buried in the
 * severity rules in lib/today-inbox.ts ("age > 5 ? high : medium"). That made
 * the platform's promises invisible: nobody could see what the target was,
 * state whether it was being met, or argue that it was wrong.
 *
 * The values below are taken FROM those thresholds deliberately, so the two
 * cannot contradict each other. Where a queue had no age rule at all (risk
 * reviews and fraud alerts were ranked purely by their own severity), a target
 * is declared here for the first time and is marked as such.
 *
 * This is detection and visibility only. There is no automatic escalation and
 * no breach notification — a breach is surfaced to a human who is already
 * looking, not pushed to one who is not. Saying so plainly matters: an "SLA"
 * that silently fails to escalate is worse than none, because it implies a
 * safety net that is not there.
 */

export interface SlaTarget {
  /** Days from arrival before this counts as breached. */
  days: number;
  /** Why this number, so it can be argued with rather than inherited. */
  rationale: string;
}

export const SLA_TARGETS: Record<string, SlaTarget> = {
  "Fraud Alerts": {
    days: 1,
    rationale:
      "NEW TARGET. A suspected fraud sitting unexamined is the platform's worst failure mode; " +
      "a day is enough to look, not enough to forget.",
  },
  "Risk Review": {
    days: 2,
    rationale:
      "NEW TARGET. A review is opened because something already looked wrong, so it should not " +
      "wait longer than the inquiry it often triggers.",
  },
  "Grievances": {
    days: 2,
    rationale:
      "NEW TARGET. A complaint about a funded organisation is the one queue where the person " +
      "waiting is not a counterparty with a contract — they have no other way in, and no " +
      "leverage if ignored. The target is deliberately tight and applies BEFORE triage, " +
      "because an untriaged grievance has no severity yet: the platform cannot know whether " +
      "it is a billing question or a safeguarding report until someone reads it.",
  },
  "Finance Exceptions": {
    days: 2,
    rationale:
      "NEW TARGET. A discrepancy in money is the one kind of defect that gets harder to " +
      "answer the longer it sits: statements close, provider records age out of easy reach, " +
      "and a donor asking where their money went cannot be told to wait. Two days matches " +
      "Grievances for the same reason — the target applies before anyone has judged how bad " +
      "the finding is, because the reconciler cannot know which of these is a rounding drift " +
      "and which is a payment nobody recorded.",
  },
  "Inquiries & Appeals": {
    days: 2,
    rationale: "An organisation that replied is waiting on us; two days matches the old threshold.",
  },
  "Opportunity approvals": {
    days: 3,
    rationale: "A funder is waiting to go live. Matches the old threshold.",
  },
  "Project Review": {
    days: 3,
    rationale: "A campaign cannot raise anything until this clears. Matches the old threshold.",
  },
  "Proof Review": {
    days: 3,
    rationale: "Evidence is already submitted; the delay is entirely ours. Matches the old threshold.",
  },
  "Impact Review": {
    days: 3,
    rationale:
      "NEW TARGET. The number is already reported and its evidence already approved, so the " +
      "delay here is entirely ours — the same reasoning as Proof Review, and the same three " +
      "days. A claim waiting in this queue is a figure the organisation cannot publish and a " +
      "donor report that cannot be completed, so the cost of sitting on it falls on someone " +
      "else.",
  },
  "NGO Verification": {
    days: 5,
    rationale: "Documents take real reading. Matches the old five-day escalation.",
  },
  "FCRA Review": {
    days: 5,
    rationale: "Certificate checks are slower and less time-critical. Matches the old threshold.",
  },
  "Matching decisions": {
    days: 5,
    rationale: "Engine proposals keep; the organisation has not been told yet. Matches the old threshold.",
  },
  "Proposal Review": {
    days: 5,
    rationale: "An organisation has written a real document and is waiting on an answer.",
  },
  "Project Completions": {
    days: 7,
    rationale: "Close-out is administrative, not blocking. Matches the old threshold.",
  },
  "Impact Health": {
    days: 7,
    rationale: "Chasing work somebody else owes; a week is a reasonable nudge cycle.",
  },
};

export type SlaState = "ok" | "at_risk" | "breached";

export function slaTargetFor(queue: string): SlaTarget | undefined {
  return SLA_TARGETS[queue];
}

/**
 * Days past target. Negative means days remaining; a queue with no declared
 * target returns null rather than 0, because "not tracked" and "exactly on
 * time" are different answers.
 */
export function daysOverTarget(queue: string, age: number): number | null {
  const target = SLA_TARGETS[queue];
  if (!target) return null;
  return age - target.days;
}

/**
 * `at_risk` is the last day before breach, not a percentage of the window. A
 * one-day target has no meaningful 75% mark, and "due tomorrow" is the thing a
 * human can still act on.
 */
export function slaState(queue: string, age: number): SlaState | null {
  const over = daysOverTarget(queue, age);
  if (over === null) return null;
  if (over > 0) return "breached";
  if (over >= -1) return "at_risk";
  return "ok";
}

/** "3d over" / "due today" / "2d left" — the label a card carries. */
export function slaLabel(queue: string, age: number): string | null {
  const over = daysOverTarget(queue, age);
  if (over === null) return null;
  if (over > 0) return `${over}d over target`;
  if (over === 0) return "due today";
  if (over === -1) return "due tomorrow";
  return `${-over}d left`;
}

/** Every queue with a declared target, longest-waiting promise last. */
export function declaredTargets(): { queue: string; target: SlaTarget }[] {
  return Object.entries(SLA_TARGETS)
    .map(([queue, target]) => ({ queue, target }))
    .sort((a, b) => a.target.days - b.target.days || a.queue.localeCompare(b.queue));
}
