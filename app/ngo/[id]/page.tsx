import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import NGOProfileClient from "./NGOProfileClient";

export default async function NGOProfilePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);

  // Fetch NGO Profile details along with projects, followers count, and active follows
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: params.id, isDeleted: false, verificationStatus: "VERIFIED" },
    include: {
      projects: {
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: {
          followers: true,
        },
      },
    },
  });

  if (!ngo) {
    notFound();
  }

  // Count distinct donors who have donated to this NGO's projects
  const donations = await prisma.donation.groupBy({
    by: ["donorId"],
    where: {
      projectId: {
        in: ngo.projects.map((p) => p.id),
      },
      status: "SUCCESS",
    },
  });
  const donorsCount = donations.length;

  // Check if current authenticated user follows this NGO
  let isFollowed = false;
  if (session?.user) {
    const followRecord = await prisma.nGOFollower.findUnique({
      where: {
        donorId_ngoId: {
          donorId: session.user.id,
          ngoId: ngo.id,
        },
      },
    });
    isFollowed = !!followRecord;
  }

  return (
    <NGOProfileClient
      ngo={ngo}
      donorsCount={donorsCount}
      initialFollowersCount={ngo._count.followers}
      initialIsFollowed={isFollowed}
      isAuthenticated={!!session?.user}
    />
  );
}
