import prisma from "@/lib/prisma";
import { computeDonorTier, selectReEngagementPath } from "@/lib/engagement-utils";
import { sendGrantModeEmail, sendNGOReferralEmail, sendTierUpgradeEmail, sendVolunteerEmail } from "@/lib/email";

/**
 * Donor re-engagement (roadmap row 12, "re-engagement signal"): once a donor has
 * received an impact report, suggest a next step that fits them — a tier
 * upgrade, another NGO in the same cause, grant mode, or volunteering.
 *
 * Moved out of POST /api/engagement/re-engage so the daily cron
 * (/api/cron/re-engagement) and the route share one implementation. It used to
 * be scheduled with a 48-hour setTimeout inside the payment webhook, which a
 * serverless function never lives long enough to fire.
 *
 * Idempotent per (donor, report): a second call — a cron re-run, a retried
 * request, a double click — returns the existing event and sends nothing.
 * A donor who opted out of project updates is never emailed.
 */

export const RE_ENGAGE_AFTER_MS = 48 * 60 * 60 * 1000;
/** Reports older than this are not re-engaged: a nudge weeks later reads as spam. */
export const RE_ENGAGE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** At most one re-engagement per donor in this period, however many reports they receive. */
export const RE_ENGAGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export type ReEngageResult =
  | { status: "created"; path: string; eventId: string }
  | { status: "exists"; eventId: string }
  | { status: "not_found" }
  | { status: "opted_out" };

export async function reEngage({ reportId, donorId }: { reportId: string; donorId: string }): Promise<ReEngageResult> {
  const existing = await prisma.reEngagementEvent.findFirst({ where: { reportId, donorId }, select: { id: true } });
  if (existing) return { status: "exists", eventId: existing.id };

  const report = await prisma.impactReport.findUnique({
    where: { id: reportId },
    include: { donor: true, donation: { include: { project: { include: { ngo: true } } } } },
  });
  if (!report || report.donorId !== donorId) return { status: "not_found" };
  if (report.donor.projectUpdatesOptOut) return { status: "opted_out" };

  const donationCount = await prisma.donation.count({ where: { donorId, status: "SUCCESS" } });
  const totalDonated = Number(report.donor.totalDonated);
  const newTier = computeDonorTier(donationCount, totalDonated);
  if (newTier !== report.donor.donorTier) {
    await prisma.user.update({ where: { id: donorId }, data: { donorTier: newTier } });
  }

  const path = selectReEngagementPath({
    persona: report.donor.donorPersona,
    donationCount,
    totalDonated,
    volunteerInterest: report.donor.volunteerInterest,
    donorTier: newTier,
  });

  let referredNGO: { id: string; orgName: string } | null = null;
  if (path === "NGO_REFERRAL") {
    const donations = await prisma.donation.findMany({
      where: { donorId, status: "SUCCESS" },
      select: { project: { select: { ngoId: true } } },
    });
    referredNGO = await prisma.nGOProfile.findFirst({
      where: {
        verificationStatus: "VERIFIED",
        isDeleted: false,
        id: { notIn: donations.map((d) => d.project.ngoId) },
        causeCategories: { hasSome: report.donation.project.ngo.causeCategories },
      },
      orderBy: { healthScore: "desc" },
      select: { id: true, orgName: true },
    });
  }

  const event = await prisma.reEngagementEvent.create({ data: { donorId, reportId, path } });
  await prisma.user.update({ where: { id: donorId }, data: { reEngagementPath: path } });

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const ctaUrl = `${baseUrl}/donor/dashboard?reEngagement=${event.id}`;
  const ngoName = report.donation.project.ngo.orgName;
  try {
    switch (path) {
      case "TIER_UPGRADE":
        await sendTierUpgradeEmail(report.donor.email, report.donor.name, donationCount, ctaUrl);
        break;
      case "NGO_REFERRAL":
        if (referredNGO) await sendNGOReferralEmail(report.donor.email, report.donor.name, ngoName, referredNGO.orgName, referredNGO.id, ctaUrl);
        break;
      case "GRANT_MODE":
        await sendGrantModeEmail(report.donor.email, report.donor.name, ngoName, totalDonated, ctaUrl);
        break;
      case "VOLUNTEER_ADVISOR":
        await sendVolunteerEmail(report.donor.email, report.donor.name, ngoName, ctaUrl);
        break;
    }
  } catch (err) {
    // The event is the record; the dashboard card shows it even if mail failed.
    console.error("[re-engagement] email failed for event", event.id, err);
  }

  return { status: "created", path, eventId: event.id };
}

/**
 * Impact reports due a re-engagement: sent at least 48h ago (and not more than
 * 14 days ago), on a successful donation, for donors who have not opted out and
 * have not been re-engaged in the last 30 days. Bounded per run; reEngage()
 * itself is idempotent per report, so an overlapping run sends nothing twice.
 */
export async function findDueReports(now: Date, take = 50) {
  return prisma.impactReport.findMany({
    where: {
      sentAt: { lte: new Date(now.getTime() - RE_ENGAGE_AFTER_MS), gte: new Date(now.getTime() - RE_ENGAGE_WINDOW_MS) },
      donation: { status: "SUCCESS" },
      donor: {
        projectUpdatesOptOut: false,
        reEngagementEvents: { none: { emailSentAt: { gte: new Date(now.getTime() - RE_ENGAGE_COOLDOWN_MS) } } },
      },
    },
    orderBy: { sentAt: "asc" },
    take,
    select: { id: true, donorId: true },
  });
}
