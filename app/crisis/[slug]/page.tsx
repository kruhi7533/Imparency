import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import CrisisDetailClient from "./CrisisDetailClient";

export const runtime = "nodejs";

export default async function CrisisDetailPage({ params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);

  const event = await prisma.crisisEvent.findUnique({
    where: { slug: params.slug },
    include: {
      campaigns: {
        where: { status: "ACTIVE" },
        select: {
          id: true, title: true, coverImage: true, targetAmount: true, raisedAmount: true,
          ngo: { select: { orgName: true } },
        },
      },
      initiatives: {
        where: { status: "PUBLISHED" },
        select: { id: true, organizerName: true, description: true, location: true, requiredFunds: true, raisedAmount: true, images: true },
      },
      updates: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { postedByNgo: { select: { orgName: true } } },
      },
      participants: { select: { ngoId: true } },
    },
  });

  if (!event || event.verificationStatus !== "VERIFIED" || event.isArchived) {
    notFound();
  }

  // Verified NGO viewing this page needs to know whether they've already joined,
  // to decide whether the client shows "Join relief effort" or "You've joined".
  let viewerNgoId: string | null = null;
  let viewerHasJoined = false;
  if (session?.user?.role === "NGO") {
    const profile = await prisma.nGOProfile.findUnique({ where: { userId: session.user.id }, select: { id: true, verificationStatus: true } });
    if (profile) {
      viewerNgoId = profile.id;
      viewerHasJoined = event.participants.some((p) => p.ngoId === profile.id);
    }
  }

  const serialized = {
    id: event.id,
    title: event.title,
    slug: event.slug,
    disasterType: event.disasterType,
    description: event.description,
    affectedLocation: event.affectedLocation,
    severity: event.severity,
    coverImage: event.coverImage,
    galleryImages: event.galleryImages,
    status: event.status,
    totalRaised: Number(event.totalRaised),
    totalDonors: event.totalDonors,
    totalNgos: event.totalNgos,
    totalCampaigns: event.totalCampaigns,
    expectedEndDate: event.expectedEndDate ? event.expectedEndDate.toISOString() : null,
    campaigns: event.campaigns.map((c) => ({
      ...c,
      targetAmount: Number(c.targetAmount),
      raisedAmount: Number(c.raisedAmount),
    })),
    initiatives: event.initiatives.map((i) => ({
      ...i,
      requiredFunds: Number(i.requiredFunds),
      raisedAmount: Number(i.raisedAmount),
    })),
    updates: event.updates.map((u) => ({
      id: u.id,
      type: u.type,
      title: u.title,
      body: u.body,
      mediaUrls: u.mediaUrls,
      fundsUtilized: u.fundsUtilized ? Number(u.fundsUtilized) : null,
      beneficiariesReached: u.beneficiariesReached,
      postedByOrgName: u.postedByNgo?.orgName ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
  };

  return (
    <CrisisDetailClient
      event={serialized}
      isNgoViewer={!!viewerNgoId}
      viewerHasJoined={viewerHasJoined}
      isSignedIn={!!session?.user}
    />
  );
}
