import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * recalculateNGOHealthScore is the only writer of NGOProfile.healthScore and
 * healthScoreBreakdown, and every number an admin sees on /admin/impact-health
 * comes out of it. It had zero test coverage.
 *
 * The two behaviours worth pinning hardest are the ones a reader gets wrong:
 *  - the "new NGO" gate writes an explicit null rather than a low score, so a
 *    young org is never shown as unhealthy just for being young;
 *  - skipped metrics redistribute their weight across the active ones, so the
 *    final weights must still sum to 100 — otherwise the score silently
 *    changes scale depending on which metrics happen to be measurable.
 */

const prismaMock = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn(), update: vi.fn() },
  milestone: { findMany: vi.fn() },
  milestoneProof: { findMany: vi.fn() },
  donation: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@prisma/client", () => ({ Prisma: { DbNull: "__DbNull__" } }));

import { recalculateNGOHealthScore } from "@/lib/ngo-health";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Distinct donor ids, each appearing `repeats(i)` times. */
function donors(unique: number, repeats: (i: number) => number = () => 1) {
  const out: { donorId: string }[] = [];
  for (let i = 0; i < unique; i++) {
    for (let r = 0; r < repeats(i); r++) out.push({ donorId: `donor-${i}` });
  }
  return out;
}

/**
 * Default scenario: healthy enough to clear the new-NGO gate with all four
 * metrics measurable. Individual tests override one piece at a time.
 *
 * Note the two milestone.findMany calls are order-dependent: the function asks
 * for pending milestones first, then all milestones.
 */
function scenario(
  over: {
    raised?: number;
    pending?: number[];
    milestoneStatuses?: string[];
    proofs?: { lateDays: number }[];
    donations?: { donorId: string }[];
  } = {}
) {
  const raised = over.raised ?? 1000;
  const pending = over.pending ?? [200];
  const statuses = over.milestoneStatuses ?? ["COMPLETED", "PENDING"];
  const proofs = over.proofs ?? [{ lateDays: 0 }];
  const donations = over.donations ?? donors(5, (i) => (i < 2 ? 2 : 1));

  prismaMock.nGOProfile.findUnique.mockResolvedValue({
    id: "ngo-1",
    projects: [{ id: "p1", raisedAmount: raised }],
  });
  prismaMock.milestone.findMany
    .mockResolvedValueOnce(pending.map((targetAmount) => ({ targetAmount })))
    .mockResolvedValueOnce(statuses.map((status) => ({ status })));
  prismaMock.milestoneProof.findMany.mockResolvedValue(
    proofs.map((p) => {
      const deadline = new Date("2026-01-10T00:00:00Z");
      return {
        submittedAt: new Date(deadline.getTime() + p.lateDays * DAY_MS),
        milestone: { deadline },
      };
    })
  );
  prismaMock.donation.findMany.mockResolvedValue(donations);
}

/** The data payload of the single nGOProfile.update the function performs. */
function written() {
  expect(prismaMock.nGOProfile.update).toHaveBeenCalledTimes(1);
  return prismaMock.nGOProfile.update.mock.calls[0][0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "time").mockImplementation(() => {});
  vi.spyOn(console, "timeEnd").mockImplementation(() => {});
});

describe("recalculateNGOHealthScore — the new-NGO gate", () => {
  it("writes null, not a low score, when no milestone has ever completed", async () => {
    scenario({ milestoneStatuses: ["PENDING", "PENDING"], donations: donors(9) });
    await recalculateNGOHealthScore("ngo-1");

    const data = written();
    expect(data.healthScore).toBeNull();
    expect(data.healthScoreBreakdown).toBe("__DbNull__");
  });

  it("writes null when fewer than 3 unique donors have given, however good the delivery", async () => {
    scenario({
      milestoneStatuses: ["COMPLETED", "COMPLETED"],
      donations: donors(2, () => 4),
    });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScore).toBeNull();
  });

  it("scores normally at exactly the gate boundary (1 completed, 3 donors)", async () => {
    scenario({
      milestoneStatuses: ["COMPLETED", "PENDING"],
      donations: donors(3),
    });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScore).toBeGreaterThan(0);
  });
});

describe("recalculateNGOHealthScore — weighting", () => {
  it("keeps the four documented weights when every metric is measurable", async () => {
    scenario();
    await recalculateNGOHealthScore("ngo-1");

    const b = written().healthScoreBreakdown;
    expect(b.utilization.weight).toBe(30);
    expect(b.completion.weight).toBe(30);
    expect(b.speed.weight).toBe(20);
    expect(b.donorReturn.weight).toBe(20);
  });

  it("redistributes a skipped metric's weight so the active weights still sum to 100", async () => {
    // 4 unique donors: past the 3-donor gate, below the 5-donor threshold that
    // makes donor-return measurable. Its 20 points must go to the other three.
    scenario({ donations: donors(4) });
    await recalculateNGOHealthScore("ngo-1");

    const b = written().healthScoreBreakdown;
    expect(b.donorReturn.score).toBeNull();
    expect(b.donorReturn.weight).toBe(0);

    const active = b.utilization.weight + b.completion.weight + b.speed.weight;
    expect(active).toBeCloseTo(100, 10);
    // 20 skipped / 3 active = 6.667 added to each.
    expect(b.speed.weight).toBeCloseTo(20 + 20 / 3, 10);
  });

  it("drops a skipped metric out of the weighted sum rather than scoring it 0", async () => {
    // No proofs at all -> speed unmeasurable. The default scenario scores
    // utilisation 80, completion 50, donorReturn 40.
    scenario({ proofs: [] });
    await recalculateNGOHealthScore("ngo-1");
    const withoutSpeed = written().healthScore;

    // Redistribution is the weighted mean of only the metrics that could be
    // measured: 36.67/36.67/26.67 over 80/50/40.
    expect(withoutSpeed).toBeCloseTo(
      (80 * (30 + 20 / 3) + 50 * (30 + 20 / 3) + 40 * (20 + 20 / 3)) / 100,
      10
    );

    // The point of redistributing rather than defaulting: had the unmeasurable
    // metric been folded in as a 0 on its original 20 points, the NGO would
    // have scored 47 instead — punished for having submitted no proof yet.
    const asIfScoredZero = (80 * 30 + 50 * 30 + 0 * 20 + 40 * 20) / 100;
    expect(asIfScoredZero).toBeCloseTo(47, 10);
    expect(withoutSpeed).toBeGreaterThan(asIfScoredZero);
  });
});

describe("recalculateNGOHealthScore — individual metrics", () => {
  it("scores utilisation as the share of raised money not still locked in pending milestones", async () => {
    scenario({ raised: 1000, pending: [250] });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScoreBreakdown.utilization.score).toBeCloseTo(75, 10);
  });

  it("clamps utilisation at 0 instead of going negative when pending exceeds what was raised", async () => {
    scenario({ raised: 100, pending: [500] });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScoreBreakdown.utilization.score).toBe(0);
  });

  it("treats a zero-raised NGO's utilisation as unmeasurable, not as 0%", async () => {
    scenario({ raised: 0, pending: [0] });
    await recalculateNGOHealthScore("ngo-1");

    const b = written().healthScoreBreakdown;
    expect(b.utilization.score).toBeNull();
    expect(b.utilization.weight).toBe(0);
  });

  it("counts both COMPLETED and VERIFIED milestones as done", async () => {
    scenario({ milestoneStatuses: ["COMPLETED", "VERIFIED", "PENDING", "PENDING"] });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScoreBreakdown.completion.score).toBeCloseTo(50, 10);
  });

  it("penalises proof lateness at 5 points per average day late", async () => {
    scenario({ proofs: [{ lateDays: 4 }] });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScoreBreakdown.speed.score).toBeCloseTo(80, 10);
  });

  it("gives early proofs no bonus — on time and early both score 100", async () => {
    scenario({ proofs: [{ lateDays: -30 }] });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScoreBreakdown.speed.score).toBe(100);
  });

  it("floors the speed score at 0 rather than going negative for very late proof", async () => {
    scenario({ proofs: [{ lateDays: 400 }] });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScoreBreakdown.speed.score).toBe(0);
  });

  it("averages lateness across proofs instead of taking the worst one", async () => {
    scenario({ proofs: [{ lateDays: 0 }, { lateDays: 10 }] });
    await recalculateNGOHealthScore("ngo-1");

    // mean delay 5 days -> 100 - 25.
    expect(written().healthScoreBreakdown.speed.score).toBeCloseTo(75, 10);
  });

  it("counts a donor as returning only from their second donation", async () => {
    // 5 donors, 1 of whom gave twice.
    scenario({ donations: donors(5, (i) => (i === 0 ? 2 : 1)) });
    await recalculateNGOHealthScore("ngo-1");

    expect(written().healthScoreBreakdown.donorReturn.score).toBeCloseTo(20, 10);
  });
});

describe("recalculateNGOHealthScore — failure handling", () => {
  it("swallows a missing NGO without writing anything", async () => {
    prismaMock.nGOProfile.findUnique.mockResolvedValue(null);
    await expect(recalculateNGOHealthScore("ghost")).resolves.toBeUndefined();
    expect(prismaMock.nGOProfile.update).not.toHaveBeenCalled();
  });

  it("swallows a database failure rather than propagating it to the caller", async () => {
    prismaMock.nGOProfile.findUnique.mockRejectedValue(new Error("connection lost"));
    await expect(recalculateNGOHealthScore("ngo-1")).resolves.toBeUndefined();
    expect(prismaMock.nGOProfile.update).not.toHaveBeenCalled();
  });

  it("produces a score on the closed 0..100 scale", async () => {
    scenario({
      raised: 1000,
      pending: [0],
      milestoneStatuses: ["COMPLETED", "VERIFIED"],
      proofs: [{ lateDays: 0 }],
      donations: donors(5, () => 2),
    });
    await recalculateNGOHealthScore("ngo-1");

    // Everything perfect -> exactly 100, not 10000 (the /100 rescale is easy
    // to drop when editing the weighted sum).
    expect(written().healthScore).toBeCloseTo(100, 10);
  });
});
