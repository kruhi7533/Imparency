import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import NGOProfileClient from "./NGOProfileClient";

export default async function NGOProfilePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);

  // Fetch NGO Profile details along with projects, followers count, and active follows.
  //
  // The follow check rides along in the same round trip rather than waiting for
  // the profile: it is keyed on `params.id`, which is the same value the
  // profile lookup filters by, so it never needed the fetched row. (The donor
  // count below is different — it genuinely depends on this NGO's project ids.)
  const [ngo, followRecord] = await Promise.all([
    prisma.nGOProfile.findUnique({
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
    }),
    session?.user
      ? prisma.nGOFollower.findUnique({
          where: {
            donorId_ngoId: {
              donorId: session.user.id,
              ngoId: params.id,
            },
          },
        })
      : null,
  ]);

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

  const isFollowed = !!followRecord;

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
