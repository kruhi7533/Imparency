import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import MatchInboxClient from "./MatchInboxClient";

export default async function MatchInboxPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "NGO") {
    redirect("/login");
  }

  const profile = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
  });

  if (!profile) {
    redirect("/ngo/register");
  }

  // Fetch SponsorRequirements. For the inbox, we mock finding gaps or just show all for demo.
  // Ideally, we fetch GapReports associated with this NGO ID, or generate them on the fly.
  // Since we might not have GapReports yet for all, we fetch all requirements and their gap reports.
  const opportunities = await prisma.sponsorRequirement.findMany({
    include: {
      gapReports: {
        where: {
          ngoId: profile.id
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-900 py-12">
      <div className="max-w-6xl mx-auto px-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Match Inbox</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Review funding opportunities from CSRs matched to your projects by our AI Gap Diagnoser.
        </p>
        
        <MatchInboxClient opportunities={opportunities} ngoId={profile.id} />
      </div>
    </main>
  );
}
