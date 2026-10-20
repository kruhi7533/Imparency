import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { judgeSignals, type PilotSignals } from "@/lib/pilot-health";

/** The pilot-health verdict: red means act now, amber slipping, green every signal in bounds — never "unchecked". */

const healthy: PilotSignals = {
  jobs: { failingOrStuck: 0, overdueOrNever: 0, total: 11 },
  slaBreaches: 0,
  openFinanceExceptions: 0,
  unresolvedHighFraud: 0,
  payments24h: { succeeded: 12, failed: 0 },
  lastWebhookAt: "2026-10-21T08:00:00.000Z",
};

describe("judgeSignals", () => {
  it("green only when every signal is inside its bound", () => {
    expect(judgeSignals(healthy).level).toBe("green");
  });

  it("red: a failing or stuck job, or an unresolved HIGH fraud alert", () => {
    expect(judgeSignals({ ...healthy, jobs: { failingOrStuck: 1, overdueOrNever: 0, total: 11 } }).level).toBe("red");
    expect(judgeSignals({ ...healthy, unresolvedHighFraud: 1 }).level).toBe("red");
  });

  it("red: payment failure rate above 20% once there are enough attempts; amber below that", () => {
    expect(judgeSignals({ ...healthy, payments24h: { succeeded: 3, failed: 2 } }).level).toBe("red");
    expect(judgeSignals({ ...healthy, payments24h: { succeeded: 1, failed: 1 } }).level).toBe("amber"); // too few to call a rate
    expect(judgeSignals({ ...healthy, payments24h: { succeeded: 20, failed: 1 } }).level).toBe("amber");
  });

  it("amber: overdue jobs, SLA breaches, open finance exceptions", () => {
    expect(judgeSignals({ ...healthy, jobs: { failingOrStuck: 0, overdueOrNever: 2, total: 11 } }).level).toBe("amber");
    expect(judgeSignals({ ...healthy, slaBreaches: 3 }).level).toBe("amber");
    expect(judgeSignals({ ...healthy, openFinanceExceptions: 1 }).level).toBe("amber");
  });

  it("a signal that could not be read is amber, never green — unknown is not fine", () => {
    const r = judgeSignals({ ...healthy, slaBreaches: null });
    expect(r.level).toBe("amber");
    expect(r.signals.find((s) => s.key === "slaBreaches")!.text).toMatch(/could not be read/);
  });

  it("every signal links to where you act on it", () => {
    for (const s of judgeSignals(healthy).signals) expect(s.href).toMatch(/^\/admin\//);
  });
});
