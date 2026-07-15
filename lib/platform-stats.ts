import prisma from "@/lib/prisma";

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

export async function getPlatformStats(): Promise<PlatformStats> {
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
