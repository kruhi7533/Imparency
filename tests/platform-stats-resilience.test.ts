import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    donation: { aggregate: vi.fn(), findMany: vi.fn() },
    nGOProfile: { count: vi.fn(), findMany: vi.fn() },
    project: { count: vi.fn(), groupBy: vi.fn() },
    milestone: { count: vi.fn() },
  },
}));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";
import { getPlatformStats } from "@/lib/platform-stats";

const mocked = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

/** Every query the stats page makes resolves; used for the happy path. */
function stubHealthyDatabase() {
  mocked(prisma.donation.aggregate).mockResolvedValue({ _sum: { amount: 500 } } as never);
  mocked(prisma.nGOProfile.count).mockResolvedValue(3 as never);
  mocked(prisma.project.count).mockResolvedValue(7 as never);
  mocked(prisma.milestone.count).mockResolvedValue(11 as never);
  mocked(prisma.donation.findMany).mockResolvedValue([] as never);
  mocked(prisma.project.groupBy).mockResolvedValue([] as never);
  mocked(prisma.nGOProfile.findMany).mockResolvedValue([] as never);
}

/** The database is unreachable — what a Vercel preview build actually sees. */
function stubUnreachableDatabase() {
  const down = new Error("Can't reach database server");
  mocked(prisma.donation.aggregate).mockRejectedValue(down as never);
  mocked(prisma.nGOProfile.count).mockRejectedValue(down as never);
  mocked(prisma.project.count).mockRejectedValue(down as never);
  mocked(prisma.milestone.count).mockRejectedValue(down as never);
  mocked(prisma.donation.findMany).mockRejectedValue(down as never);
  mocked(prisma.project.groupBy).mockRejectedValue(down as never);
  mocked(prisma.nGOProfile.findMany).mockRejectedValue(down as never);
}

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  // Restore rather than delete: leaking a VERCEL_ENV into the next file would
  // flip this module's behaviour there and the failure would look unrelated.
  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
});

describe("getPlatformStats", () => {
  it("returns real figures when the database is reachable", async () => {
    stubHealthyDatabase();

    const stats = await getPlatformStats();

    expect(stats.totalDonated).toBe(500);
    expect(stats.verifiedNgoCount).toBe(3);
    expect(captureError).not.toHaveBeenCalled();
  });

  /**
   * The bug this whole change exists for: `/` is statically generated
   * (`revalidate = 60`), so these queries run at BUILD time and a preview
   * deployment with no DATABASE_URL crashed the build.
   */
  it("degrades to empty stats instead of crashing a preview build", async () => {
    process.env.VERCEL_ENV = "preview";
    stubUnreachableDatabase();

    const stats = await getPlatformStats();

    expect(stats.totalDonated).toBe(0);
    expect(stats.verifiedNgoCount).toBe(0);
    expect(stats.recentActivity).toEqual([]);
    // Degraded, but never silent.
    expect(captureError).toHaveBeenCalled();
  });

  /**
   * The guard rail on the fix. Swallowing this in production would ship a
   * landing page reading "₹0 donated" during a real outage — a worse and much
   * harder-to-notice bug than the build failure being fixed.
   */
  it("still throws in production, so a real outage stays loud", async () => {
    process.env.VERCEL_ENV = "production";
    stubUnreachableDatabase();

    await expect(getPlatformStats()).rejects.toThrow("Can't reach database server");
  });

  it("reports zero rather than inventing figures", async () => {
    // Guards against a future 'friendlier' fallback with placeholder numbers.
    // On a donation platform an invented total is a false public claim.
    process.env.VERCEL_ENV = "preview";
    stubUnreachableDatabase();

    const stats = await getPlatformStats();

    expect(stats.totalDonated).toBe(0);
    expect(stats.completedMilestoneCount).toBe(0);
    expect(stats.verifiedNgoNames).toEqual([]);
    expect(stats.causeCategoryCounts).toEqual({});
  });
});
