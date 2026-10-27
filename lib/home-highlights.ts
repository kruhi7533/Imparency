import prisma from "@/lib/prisma";

/**
 * The homepage's "show, don't claim" figures — everything the hero and the
 * featured-campaign row print comes from here, straight from the database.
 * Anything without a real value is returned as null/empty so the page hides
 * the widget instead of inventing a number.
 */

export interface FeaturedCampaign {
  id: string;
  title: string;
  causeCategory: string;
  coverImage: string;
  location: string;
  raised: number;
  target: number;
  ngoName: string;
  ngoVerified: boolean;
}

export interface HomeHighlights {
  featured: FeaturedCampaign[];
  /** A real project cover photo for the hero, or null when none is usable. */
  heroImage: { src: string; alt: string } | null;
  /** Distinct donors with at least one successful donation. */
  donorCount: number;
  /** Initials of the most recent distinct donors (never names or photos). */
  donorInitials: string[];
  /**
   * Share of approved milestones whose approval landed on or before the
   * milestone's deadline. Null until at least ON_TIME_MIN_SAMPLE milestones
   * have been approved — a percentage of one or two reads as a trend it isn't.
   */
  onTimeMilestonePct: number | null;
  approvedMilestoneCount: number;
}

/** Below this many approved milestones the on-time share is not shown. */
export const ON_TIME_MIN_SAMPLE = 5;

const isRemoteImage = (src: string | null | undefined): src is string =>
  !!src && /^https?:\/\//.test(src);

function initialsOf(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

export async function getHomeHighlights(): Promise<HomeHighlights> {
  const [projects, donorGroups, recentDonors, approvedMilestones] = await Promise.all([
    prisma.project.findMany({
      where: {
        status: "ACTIVE",
        isDeleted: false,
        ngo: { isDeleted: false, isSuspended: false },
      },
      orderBy: [{ raisedAmount: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        title: true,
        causeCategory: true,
        coverImage: true,
        location: true,
        raisedAmount: true,
        targetAmount: true,
        ngo: { select: { orgName: true, verificationStatus: true } },
      },
    }),
    prisma.donation.groupBy({
      by: ["donorId"],
      where: { status: "SUCCESS" },
    }),
    prisma.donation.findMany({
      where: { status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      distinct: ["donorId"],
      take: 4,
      select: { donor: { select: { name: true } } },
    }),
    prisma.milestone.findMany({
      where: {
        status: { in: ["VERIFIED", "COMPLETED"] },
        reviews: { some: { action: "APPROVED" } },
      },
      select: {
        deadline: true,
        reviews: {
          where: { action: "APPROVED" },
          orderBy: { reviewedAt: "asc" },
          take: 1,
          select: { reviewedAt: true },
        },
      },
    }),
  ]);

  const featured: FeaturedCampaign[] = projects.map((p) => ({
    id: p.id,
    title: p.title,
    causeCategory: p.causeCategory,
    coverImage: p.coverImage,
    location: p.location,
    raised: Number(p.raisedAmount),
    target: Number(p.targetAmount),
    ngoName: p.ngo.orgName,
    ngoVerified: p.ngo.verificationStatus === "VERIFIED",
  }));

  // The hero is about people, so prefer a people-centred cause's photo (a
  // classroom, a clinic) over, say, a cleanup site; any real cover otherwise.
  const PEOPLE_CAUSES = ["Education", "Healthcare", "Women Empowerment", "Hunger", "Child Welfare"];
  const withImage = featured.filter((p) => isRemoteImage(p.coverImage));
  const heroSource = withImage.find((p) => PEOPLE_CAUSES.includes(p.causeCategory ?? "")) ?? withImage[0];

  const onTime = approvedMilestones.filter(
    (m) => m.reviews[0] && m.reviews[0].reviewedAt.getTime() <= m.deadline.getTime()
  ).length;

  return {
    featured,
    heroImage: heroSource ? { src: heroSource.coverImage, alt: heroSource.title } : null,
    donorCount: donorGroups.length,
    donorInitials: recentDonors.map((d) => initialsOf(d.donor.name)),
    onTimeMilestonePct:
      approvedMilestones.length >= ON_TIME_MIN_SAMPLE ? Math.round((onTime / approvedMilestones.length) * 100) : null,
    approvedMilestoneCount: approvedMilestones.length,
  };
}
