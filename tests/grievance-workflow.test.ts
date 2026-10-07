import { describe, it, expect } from "vitest";
import { GrievanceStatus } from "@prisma/client";
import {
  GRIEVANCE_TRANSITIONS,
  GRIEVANCE_ACTIONS,
  isGrievanceAction,
  isTerminal,
  requiresNote,
  requiresSeverity,
  explainRefusal,
  TERMINAL_GRIEVANCE_STATUSES,
  type GrievanceAction,
} from "@/lib/grievance-workflow";

/**
 * The grievance state machine, tested without a request.
 *
 * This is the "approval state machine" test CLAUDE.md treats as mandatory. The
 * invariant that matters most here is NOT that the happy path works — it is
 * that the two cheap ways to make a complaint go away are blocked: dismissing
 * it straight out of the queue, and reopening something already closed.
 */

const ALL_STATUSES = Object.values(GrievanceStatus);

describe("the legal chain", () => {
  it("runs OPEN -> TRIAGED -> INVESTIGATING -> RESOLVED | DISMISSED", () => {
    expect(GRIEVANCE_TRANSITIONS.TRIAGE).toMatchObject({
      from: GrievanceStatus.OPEN,
      to: GrievanceStatus.TRIAGED,
    });
    expect(GRIEVANCE_TRANSITIONS.START_INVESTIGATION).toMatchObject({
      from: GrievanceStatus.TRIAGED,
      to: GrievanceStatus.INVESTIGATING,
    });
    expect(GRIEVANCE_TRANSITIONS.RESOLVE).toMatchObject({
      from: GrievanceStatus.INVESTIGATING,
      to: GrievanceStatus.RESOLVED,
    });
    expect(GRIEVANCE_TRANSITIONS.DISMISS).toMatchObject({
      from: GrievanceStatus.INVESTIGATING,
      to: GrievanceStatus.DISMISSED,
    });
  });

  it("exposes exactly four actions", () => {
    expect(GRIEVANCE_ACTIONS.sort()).toEqual(
      ["DISMISS", "RESOLVE", "START_INVESTIGATION", "TRIAGE"].sort()
    );
  });

  it("rejects anything that is not one of them", () => {
    expect(isGrievanceAction("CLOSE")).toBe(false);
    expect(isGrievanceAction("")).toBe(false);
    expect(isGrievanceAction(undefined)).toBe(false);
    expect(isGrievanceAction(null)).toBe(false);
    expect(isGrievanceAction({ action: "TRIAGE" })).toBe(false);
    // Not a prototype property either.
    expect(isGrievanceAction("toString")).toBe(false);
  });
});

describe("a complaint cannot be made to disappear cheaply", () => {
  it("CANNOT be dismissed straight from OPEN — someone has to look first", () => {
    // The whole point of the longer chain. A one-click dismissal from the
    // queue would make the cheapest action also the one that ends the
    // complaint.
    expect(GRIEVANCE_TRANSITIONS.DISMISS.from).not.toBe(GrievanceStatus.OPEN);
    expect(GRIEVANCE_TRANSITIONS.DISMISS.from).toBe(GrievanceStatus.INVESTIGATING);
  });

  it("CANNOT be dismissed from TRIAGED either — triage is a judgement, not a look", () => {
    expect(GRIEVANCE_TRANSITIONS.DISMISS.from).not.toBe(GrievanceStatus.TRIAGED);
  });

  it("CANNOT be resolved without being investigated", () => {
    expect(GRIEVANCE_TRANSITIONS.RESOLVE.from).toBe(GrievanceStatus.INVESTIGATING);
  });

  it("treats RESOLVED and DISMISSED as terminal, and nothing else", () => {
    expect(TERMINAL_GRIEVANCE_STATUSES.sort()).toEqual(
      [GrievanceStatus.DISMISSED, GrievanceStatus.RESOLVED].sort()
    );
    expect(isTerminal(GrievanceStatus.RESOLVED)).toBe(true);
    expect(isTerminal(GrievanceStatus.DISMISSED)).toBe(true);
    expect(isTerminal(GrievanceStatus.OPEN)).toBe(false);
    expect(isTerminal(GrievanceStatus.TRIAGED)).toBe(false);
    expect(isTerminal(GrievanceStatus.INVESTIGATING)).toBe(false);
  });

  it("has no action that leads back out of a terminal status", () => {
    // Exhaustive over the transition table rather than a spot check: adding a
    // REOPEN action later would fail here, which is the point.
    for (const action of GRIEVANCE_ACTIONS) {
      expect(isTerminal(GRIEVANCE_TRANSITIONS[action].from)).toBe(false);
    }
  });

  it("never has two actions legal from the same status, so a status has one next move per outcome", () => {
    // INVESTIGATING legitimately has two (resolve or dismiss); nothing else
    // should. A second action from OPEN would be a bypass.
    const byFrom = new Map<GrievanceStatus, GrievanceAction[]>();
    for (const action of GRIEVANCE_ACTIONS) {
      const from = GRIEVANCE_TRANSITIONS[action].from;
      byFrom.set(from, [...(byFrom.get(from) ?? []), action]);
    }
    expect(byFrom.get(GrievanceStatus.OPEN)).toEqual(["TRIAGE"]);
    expect(byFrom.get(GrievanceStatus.TRIAGED)).toEqual(["START_INVESTIGATION"]);
    expect(byFrom.get(GrievanceStatus.INVESTIGATING)?.sort()).toEqual(["DISMISS", "RESOLVE"]);
  });
});

describe("what each action demands of the admin", () => {
  it("requires a severity at triage and nowhere else", () => {
    expect(requiresSeverity("TRIAGE")).toBe(true);
    expect(requiresSeverity("START_INVESTIGATION")).toBe(false);
    expect(requiresSeverity("RESOLVE")).toBe(false);
    expect(requiresSeverity("DISMISS")).toBe(false);
  });

  it("requires a written reason for BOTH ways of closing it", () => {
    expect(requiresNote("RESOLVE")).toBe(true);
    expect(requiresNote("DISMISS")).toBe(true);
    expect(requiresNote("TRIAGE")).toBe(false);
    expect(requiresNote("START_INVESTIGATION")).toBe(false);
  });
});

describe("explainRefusal", () => {
  it("tells a reporter-facing truth about a closed complaint: file again", () => {
    const message = explainRefusal("RESOLVE", GrievanceStatus.DISMISSED);
    expect(message).toContain("dismissed");
    expect(message).toContain("new report");
  });

  it("explains a premature dismissal as needing someone to look", () => {
    const message = explainRefusal("DISMISS", GrievanceStatus.OPEN);
    expect(message).toContain("under investigation");
    expect(message).toContain("look at it first");
  });

  it("names the status actually required for the ordinary refusals", () => {
    expect(explainRefusal("START_INVESTIGATION", GrievanceStatus.OPEN)).toContain("triaged");
  });

  it("produces a non-empty message for every action-status pair", () => {
    // Guards against a template that silently renders "undefined" for a
    // combination nobody tried by hand.
    for (const action of GRIEVANCE_ACTIONS) {
      for (const status of ALL_STATUSES) {
        const message = explainRefusal(action, status);
        expect(message.length).toBeGreaterThan(10);
        expect(message).not.toContain("undefined");
      }
    }
  });
});
