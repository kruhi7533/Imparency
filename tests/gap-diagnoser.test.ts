import { describe, it, expect, vi, beforeEach } from "vitest";

import * as repo from "@/src/agents/gap-diagnoser/repositories/gapReportRepository";

vi.mock("@/lib/prisma", () => ({
  default: {
    gapReport: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}));

// Matching/scoring behaviour is covered in tests/matching-engine.test.ts.

describe("Gap Diagnoser - Repository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates and fetches a gap report via repository wrappers", async () => {
    const payload = {
      sponsorRequirementId: "req_1",
      overallCompatibility: 42,
      gapReport: { overallCompatibility: 42, gaps: [] },
      recommendations: [],
      reviewedBy: null,
    };

    // @ts-ignore mocked prisma
    const prisma = (await import("@/lib/prisma")).default;
    (prisma.gapReport.create as any).mockResolvedValue({ id: "gap_1", ...payload });
    (prisma.gapReport.findUnique as any).mockResolvedValue({ id: "gap_1", ...payload });

    const created = await repo.createGapReport(payload as any);
    expect(created.id).toBe("gap_1");

    const fetched = await repo.getGapReportById("gap_1");
    expect(fetched!.id).toBe("gap_1");
  });
});
