import { describe, it, expect } from "vitest";
import {
  SLA_TARGETS,
  daysOverTarget,
  declaredTargets,
  slaLabel,
  slaState,
  slaTargetFor,
} from "@/lib/sla";

/**
 * What these tests protect.
 *
 * A target nobody can see is not a promise, and a promise the code contradicts
 * is worse than none. These pin the two things that make the targets real:
 * every queue the inbox produces has one, and "breached" means the same thing
 * everywhere it is asked.
 */

describe("the declared targets", () => {
  it("covers every queue the inbox can produce", () => {
    // A queue with no target silently opts out of being measured.
    const inboxQueues = [
      "NGO Verification",
      "Opportunity approvals",
      "Project Review",
      "Project Completions",
      "Proposal Review",
      "Proof Review",
      "FCRA Review",
      "Matching decisions",
      "Risk Review",
      "Fraud Alerts",
      "Inquiries & Appeals",
      "Impact Health",
    ];
    for (const queue of inboxQueues) {
      expect(slaTargetFor(queue), `no SLA target declared for "${queue}"`).toBeDefined();
    }
  });

  it("states a reason for every target", () => {
    // A number with no rationale cannot be argued with, only inherited.
    for (const [queue, target] of Object.entries(SLA_TARGETS)) {
      expect(target.rationale.length, `${queue} has no rationale`).toBeGreaterThan(20);
      expect(target.days).toBeGreaterThan(0);
    }
  });

  it("lists targets tightest-first", () => {
    const days = declaredTargets().map((t) => t.target.days);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  it("treats an unknown queue as untracked, not as on-time", () => {
    // null and 0 are different answers: "not measured" vs "exactly on target".
    expect(slaTargetFor("Nonexistent")).toBeUndefined();
    expect(daysOverTarget("Nonexistent", 99)).toBeNull();
    expect(slaState("Nonexistent", 99)).toBeNull();
    expect(slaLabel("Nonexistent", 99)).toBeNull();
  });
});

describe("breach detection", () => {
  // Fraud Alerts: 1 day. Proof Review: 3 days.
  it("is not breached on the target day itself", () => {
    expect(slaState("Fraud Alerts", 1)).toBe("at_risk");
    expect(slaState("Proof Review", 3)).toBe("at_risk");
  });

  it("is breached the day after the target", () => {
    expect(slaState("Fraud Alerts", 2)).toBe("breached");
    expect(slaState("Proof Review", 4)).toBe("breached");
  });

  it("warns on the last day before the target", () => {
    expect(slaState("Proof Review", 2)).toBe("at_risk");
  });

  it("is ok with more than a day to spare", () => {
    expect(slaState("Proof Review", 0)).toBe("ok");
    expect(slaState("Proof Review", 1)).toBe("ok");
  });

  it("reports how far past the target something is", () => {
    expect(daysOverTarget("Proof Review", 10)).toBe(7);
    expect(daysOverTarget("Proof Review", 3)).toBe(0);
    expect(daysOverTarget("Proof Review", 1)).toBe(-2);
  });
});

describe("the label on a card", () => {
  it("counts days over once past the target", () => {
    expect(slaLabel("Proof Review", 6)).toBe("3d over target");
  });

  it("says due today on the target day", () => {
    expect(slaLabel("Proof Review", 3)).toBe("due today");
  });

  it("says due tomorrow on the last day before", () => {
    expect(slaLabel("Proof Review", 2)).toBe("due tomorrow");
  });

  it("counts down when there is time left", () => {
    expect(slaLabel("Proof Review", 0)).toBe("3d left");
  });
});
