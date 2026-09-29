import prisma from "@/lib/prisma";
import { captureError } from "@/lib/observability";

export interface RecentDonationActivity {
  id: string;
  donorFirstName: string;
  amount: number;
  projectTitle: string;
  ngoName: string;
  createdAt: string;
}

export interface PlatformStats {
  totalDonated: number;
  verifiedNgoCount: number;
  activeProjectCount: number;
  completedMilestoneCount: number;
  recentActivity: RecentDonationActivity[];
  causeCategoryCounts: Record<string, number>;
  verifiedNgoNames: string[];
}

function firstNameOnly(fullName: string): string {
  const first = (fullName || "Anonymous").trim().split(/\s+/)[0];
  return first || "Anonymous";
}

/**
 * Shown when the stats query cannot run at all. Deliberately zeroed rather than
 * invented: a landing page claiming donations that did not happen is worse than
 * one showing nothing.
 */
const EMPTY_STATS: PlatformStats = {
  totalDonated: 0,
  verifiedNgoCount: 0,
  activeProjectCount: 0,
  completedMilestoneCount: 0,
  recentActivity: [],
  causeCategoryCounts: {},
  verifiedNgoNames: [],
};

/**
 * `app/page.tsx` sets `revalidate = 60`, so `/` is STATICALLY GENERATED and
 * these seven queries run at BUILD time. That made a database a hard build
 * dependency, which is why every Vercel preview deployment failed: previews
 * have no DATABASE_URL, the build crashed here, and the resulting permanent red
 * X on every PR taught everyone to merge past failing checks.
 *
 * Outside production, a failure here now degrades to empty stats so the build
 * completes. IN PRODUCTION IT STILL THROWS — a real outage must stay loud, and
 * silently shipping a landing page reading "₹0 donated" on a donation platform
 * would be a worse bug than the one this fixes.
 */
export async function getPlatformStats(): Promise<PlatformStats> {
  try {
    return await queryPlatformStats();
  } catch (err) {
    if (process.env.VERCEL_ENV === "production") throw err;
    captureError(err as Error, { scope: "platform-stats", operation: "get_platform_stats" }, "warning");
    console.warn("[platform-stats] Database unavailable — rendering empty stats (non-production only).");
    return EMPTY_STATS;
  }
}

async function queryPlatformStats(): Promise<PlatformStats> {
  const [donationAgg, verifiedNgoCount, activeProjectCount, completedMilestoneCount, recentDonations, causeGroups, verifiedNgos] =
    await Promise.all([
      prisma.donation.aggregate({
        where: { status: "SUCCESS" },
        _sum: { amount: true },
      }),
      prisma.nGOProfile.count({
        where: { verificationStatus: "VERIFIED", isDeleted: false, isSuspended: false },
      }),
      prisma.project.count({
        where: { status: "ACTIVE", isDeleted: false },
      }),
      prisma.milestone.count({
        where: { status: "COMPLETED" },
      }),
      prisma.donation.findMany({
        where: { status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          donor: { select: { name: true } },
          project: { select: { title: true, ngo: { select: { orgName: true } } } },
        },
      }),
      prisma.project.groupBy({
        by: ["causeCategory"],
        where: { status: "ACTIVE", isDeleted: false },
        _count: true,
      }),
      prisma.nGOProfile.findMany({
        where: { verificationStatus: "VERIFIED", isDeleted: false, isSuspended: false },
        orderBy: { createdAt: "asc" },
        take: 12,
        select: { orgName: true },
      }),
    ]);

  return {
    totalDonated: Number(donationAgg._sum.amount ?? 0),
    verifiedNgoCount,
    activeProjectCount,
    completedMilestoneCount,
    recentActivity: recentDonations.map((d) => ({
      id: d.id,
      donorFirstName: firstNameOnly(d.donor.name),
      amount: Number(d.amount),
      projectTitle: d.project.title,
      ngoName: d.project.ngo.orgName,
      createdAt: d.createdAt.toISOString(),
    })),
    causeCategoryCounts: Object.fromEntries(causeGroups.map((g) => [g.causeCategory, g._count])),
    verifiedNgoNames: verifiedNgos.map((n) => n.orgName),
  };
}
