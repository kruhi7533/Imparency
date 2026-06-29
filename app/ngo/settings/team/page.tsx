import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import TeamSettingsClient from "./TeamSettingsClient";

export default async function TeamSettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.ngoProfileId) {
    redirect("/login");
  }

  // Fetch current user's role in this NGO
  const currentUserMembership = await prisma.nGOTeamMember.findUnique({
    where: {
      userId_ngoId: {
        userId: session.user.id,
        ngoId: session.user.ngoProfileId,
      }
    }
  });

  if (!currentUserMembership) {
    redirect("/unauthorized");
  }

  // Fetch all team members for this NGO
  const teamMembers = await prisma.nGOTeamMember.findMany({
    where: {
      ngoId: session.user.ngoProfileId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        }
      }
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <TeamSettingsClient 
          teamMembers={teamMembers} 
          currentUserRole={currentUserMembership.role} 
        />
      </main>
    </div>
  );
}
