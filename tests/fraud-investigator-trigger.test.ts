import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  fraudInvestigation: { findFirst: vi.fn() },
}));
const resolveNgoIdMock = vi.hoisted(() => vi.fn());
const investigateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/fraud-investigator/resolve-ngo", () => ({ resolveNgoId: resolveNgoIdMock }));
vi.mock("@/lib/fraud-investigator/run", () => ({ investigate: investigateMock }));
vi.mock("@/lib/fraud-investigator/config", () => ({
  INVESTIGATOR_ENABLED: true,
  BACKGROUND_WALL_CLOCK_MS: 1000,
}));

import { maybeInvestigate } from "@/lib/fraud-investigator/trigger";

/**
 * What these tests protect.
 *
 * lib/risk-agent.ts used to declare entityType "NGO" on alerts whose entityId
 * was a MILESTONE or PROJECT id. Correcting those types would have silently
 * stopped the investigator firing on low-proof-score alerts — the gate here
 * tested the literal string "NGO". These pin that the gate follows what the
 * alert is ABOUT, not what table its id happens to live in.
 */

beforeEach(() => {
  vi.clearAllMocks();
  resolveNgoIdMock.mockResolvedValue("ngo_1");
  prismaMock.fraudInvestigation.findFirst.mockResolvedValue(null);
  investigateMock.mockResolvedValue(undefined);
});

describe("which alerts reach the investigator", () => {
  it("investigates a HIGH alert on an organisation", async () => {
    await maybeInvestigate("NGO", "ngo_1", "HIGH", "alert_1");
    expect(investigateMock).toHaveBeenCalledTimes(1);
  });

  it("still investigates a HIGH alert that points at a milestone", async () => {
    // The regression this file exists for: EXTREMELY_LOW_PROOF_SCORE.
    await maybeInvestigate("MILESTONE", "milestone_3", "HIGH", "alert_1");
    expect(investigateMock).toHaveBeenCalledTimes(1);
    expect(resolveNgoIdMock).toHaveBeenCalledWith("milestone_3");
  });

  it("still investigates a HIGH alert that points at a project", async () => {
    await maybeInvestigate("PROJECT", "project_3", "HIGH", "alert_1");
    expect(investigateMock).toHaveBeenCalledTimes(1);
  });

  it("investigates against the resolved organisation, not the raw entity id", async () => {
    resolveNgoIdMock.mockResolvedValue("ngo_42");
    await maybeInvestigate("MILESTONE", "milestone_3", "HIGH", "alert_1");
    expect(investigateMock).toHaveBeenCalledWith(
      "ngo_42",
      "alert_1",
      "alert:alert_1",
      expect.anything()
    );
  });
});

describe("which alerts do not", () => {
  it("ignores a donor alert — the investigator only reads organisation evidence", async () => {
    await maybeInvestigate("DONOR", "donor_1", "HIGH", "alert_1");
    expect(investigateMock).not.toHaveBeenCalled();
  });

  it("ignores anything below HIGH", async () => {
    for (const severity of ["MEDIUM", "LOW"]) {
      await maybeInvestigate("MILESTONE", "milestone_3", severity, "alert_1");
    }
    expect(investigateMock).not.toHaveBeenCalled();
  });

  it("ignores an id that resolves to no organisation", async () => {
    resolveNgoIdMock.mockResolvedValue(null);
    await maybeInvestigate("MILESTONE", "gone", "HIGH", "alert_1");
    expect(investigateMock).not.toHaveBeenCalled();
  });

  it("debounces a second alert for the same organisation", async () => {
    // Verification triage can raise several HIGH alerts within seconds; one
    // investigation covers them.
    prismaMock.fraudInvestigation.findFirst.mockResolvedValue({ id: "recent" });
    await maybeInvestigate("NGO", "ngo_1", "HIGH", "alert_2");
    expect(investigateMock).not.toHaveBeenCalled();
  });
});
