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

  // Fetch SHORTLISTED MatchCandidates for this NGO
  const candidates = await prisma.matchCandidate.findMany({
    where: {
      ngoId: profile.id,
      decision: "SHORTLISTED"
    },
    include: {
      job: {
        include: {
          opportunity: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Map to the shape MatchInboxClient expects
  const opportunities = candidates.map(c => ({
    id: c.job.opportunityId,
    title: c.job.opportunity.title,
    createdAt: c.job.opportunity.createdAt,
    extractedData: {
      sector: "Various",
      state: "India",
      budget: c.job.opportunity.amount?.toString() || "Unknown"
    },
    gapReports: [{
      overallCompatibility: c.verdict === "ELIGIBLE" ? 100 : 80,
      gapReport: c.reasons
    }],
    matchCandidateId: c.id
  }));

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-zinc-900 py-12">
      <div className="max-w-6xl mx-auto px-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Match Inbox</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Review funding opportunities from CSRs matched to your projects by our Eligibility Engine.
        </p>
        
        <MatchInboxClient opportunities={opportunities} ngoId={profile.id} />
      </div>
    </main>
  );
}
