import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression: clicking "Investigate" on an EXTREMELY_LOW_PROOF_SCORE alert
 * threw a P2003 foreign-key violation (500). Those alerts declare
 * entityType "NGO" but store a MILESTONE id — entityType says whose problem it
 * is, not what the id points at. Same for DEADLINE_EXCEEDED (milestone) and
 * INACTIVE_CAMPAIGN_FUNDS (project).
 */

const prismaMock = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  milestone: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { resolveNgoId } from "@/lib/fraud-investigator/resolve-ngo";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.nGOProfile.findUnique.mockResolvedValue(null);
  prismaMock.milestone.findUnique.mockResolvedValue(null);
  prismaMock.project.findUnique.mockResolvedValue(null);
});

describe("resolveNgoId", () => {
  it("passes through an id that is already an NGO", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-1" });
    await expect(resolveNgoId("ngo-1")).resolves.toBe("ngo-1");
    // Should not have bothered looking further.
    expect(prismaMock.milestone.findUnique).not.toHaveBeenCalled();
  });

  it("resolves a milestone id to its owning NGO", async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({ project: { ngoId: "ngo-2" } });
    await expect(resolveNgoId("milestone-1")).resolves.toBe("ngo-2");
  });

  it("resolves a project id to its owning NGO", async () => {
    prismaMock.project.findUnique.mockResolvedValue({ ngoId: "ngo-3" });
    await expect(resolveNgoId("project-1")).resolves.toBe("ngo-3");
  });

  it("returns null for an id that matches nothing, so callers can 400 rather than 500", async () => {
    await expect(resolveNgoId("garbage")).resolves.toBeNull();
  });

  it("returns null for an empty id without querying anything", async () => {
    await expect(resolveNgoId("")).resolves.toBeNull();
    expect(prismaMock.nGOProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe("investigate() guard", () => {
  it("refuses a non-existent NGO id instead of throwing a foreign-key error", async () => {
    vi.resetModules();
    const guardPrisma = {
      nGOProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      fraudInvestigation: { create: vi.fn() },
    };
    vi.doMock("@/lib/prisma", () => ({ default: guardPrisma }));

    const { investigate } = await import("@/lib/fraud-investigator/run");
    const result = await investigate("not-an-ngo", null, "test");

    expect(result.status).toBe("FAILED");
    expect(result.summary).toMatch(/No NGO exists/);
    // Critically: no row was attempted, so no P2003 and no orphan record.
    expect(guardPrisma.fraudInvestigation.create).not.toHaveBeenCalled();
  });
});
