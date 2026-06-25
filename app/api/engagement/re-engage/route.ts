import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { computeDonorTier, selectReEngagementPath } from "@/lib/engagement-utils";
import {
  sendTierUpgradeEmail,
  sendNGOReferralEmail,
  sendGrantModeEmail,
  sendVolunteerEmail,
} from "@/lib/email";

export async function POST(request: Request) {
  try {
    // Allow internal server-to-server calls with secret header
    const internalSecret = request.headers.get("x-internal-secret");
    const isInternalCall =
      internalSecret &&
      internalSecret === process.env.INTERNAL_API_SECRET &&
      process.env.INTERNAL_API_SECRET !== "";

    let donorId: string;
    let reportId: string;

    if (isInternalCall) {
      // Internal call from webhook — read donorId and reportId from body directly
      const body = await request.json();
      donorId = body.donorId;
      reportId = body.reportId;
      if (!donorId) {
        return NextResponse.json({ error: "donorId required for internal calls" }, { status: 400 });
      }
      if (!reportId) {
        return NextResponse.json({ error: "reportId required for internal calls" }, { status: 400 });
      }
    } else {
      // External call — require DONOR session
      const { authorized, session, response } = await verifySessionRole("DONOR");
      if (!authorized) return response!;
      donorId = session!.user.id;

      const body = await request.json();
      reportId = body.reportId;
      if (!reportId) {
        return NextResponse.json({ error: "reportId is required" }, { status: 400 });
      }
    }

    // Fetch the ImpactReport with full donor + donation context
    const report = await prisma.impactReport.findUnique({
      where: { id: reportId },
      include: {
        donor: true,
        donation: {
          include: {
            project: {
              include: { ngo: true },
            },
          },
        },
      },
    });

    if (!report || report.donorId !== donorId) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // Count donor's total donations and compute tier
    const donationCount = await prisma.donation.count({
      where: { donorId: donorId, status: "SUCCESS" },
    });
    const totalDonated = Number(report.donor.totalDonated);
    const newTier = computeDonorTier(donationCount, totalDonated);

    // Update donor tier if changed
    if (newTier !== report.donor.donorTier) {
      await prisma.user.update({
        where: { id: donorId },
        data: { donorTier: newTier },
      });
    }

    // Select re-engagement path
    const path = selectReEngagementPath({
      persona: report.donor.donorPersona,
      donationCount,
      totalDonated,
      volunteerInterest: report.donor.volunteerInterest,
      donorTier: newTier,
    });

    // Find referred NGO if path is NGO_REFERRAL
    let referredNGO: { id: string; orgName: string; causeCategories: string[]; description: string } | null = null;
    if (path === "NGO_REFERRAL") {
      // Find a VERIFIED NGO the donor has NOT donated to yet,
      // with overlapping causeCategories to the current NGO
      const donations = await prisma.donation.findMany({
        where: { donorId: donorId, status: "SUCCESS" },
        select: { project: { select: { ngoId: true } } },
      });
      const donatedNgoIds = donations.map((d) => d.project.ngoId);

      referredNGO = await prisma.nGOProfile.findFirst({
        where: {
          verificationStatus: "VERIFIED",
          isDeleted: false,
          id: { notIn: donatedNgoIds },
          causeCategories: {
            hasSome: report.donation.project.ngo.causeCategories,
          },
        },
        orderBy: { healthScore: "desc" },
        select: { id: true, orgName: true, causeCategories: true, description: true },
      });
    }

    // Create ReEngagementEvent record
    const event = await prisma.reEngagementEvent.create({
      data: {
        donorId: donorId,
        reportId,
        path,
      },
    });

    // Update User.reEngagementPath
    await prisma.user.update({
      where: { id: donorId },
      data: { reEngagementPath: path },
    });

    // Send appropriate email
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const ctaUrl = `${baseUrl}/donor/dashboard?reEngagement=${event.id}`;

    switch (path) {
      case "TIER_UPGRADE":
        await sendTierUpgradeEmail(
          report.donor.email,
          report.donor.name,
          donationCount,
          ctaUrl
        );
        break;
      case "NGO_REFERRAL":
        if (referredNGO) {
          await sendNGOReferralEmail(
            report.donor.email,
            report.donor.name,
            report.donation.project.ngo.orgName,
            referredNGO.orgName,
            referredNGO.id,
            ctaUrl
          );
        }
        break;
      case "GRANT_MODE":
        await sendGrantModeEmail(
          report.donor.email,
          report.donor.name,
          report.donation.project.ngo.orgName,
          totalDonated,
          ctaUrl
        );
        break;
      case "VOLUNTEER_ADVISOR":
        await sendVolunteerEmail(
          report.donor.email,
          report.donor.name,
          report.donation.project.ngo.orgName,
          ctaUrl
        );
        break;
    }

    return NextResponse.json({ success: true, path, eventId: event.id });
  } catch (error) {
    const err = error as Error;
    console.error("Error running re-engagement POST API:", err);
    return NextResponse.json(
      { error: err.message || "Failed to trigger re-engagement." },
      { status: 500 }
    );
  }
}
