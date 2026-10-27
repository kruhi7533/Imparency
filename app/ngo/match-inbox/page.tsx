import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import MatchInboxClient from "./MatchInboxClient";
import { getActor, resolveNgoMembership } from "@/lib/requirements/access";
import { listOpportunitiesForNgo, type NgoOpportunity } from "@/lib/requirements/opportunities";
import { NGO_RESPONSE_STATUS_LABELS } from "@/lib/requirements/response-status";
import { formatBudgetRange } from "@/components/requirements/api";

export const dynamic = "force-dynamic";

/** What the NGO has to do next on a CSR invitation, if anything. */
function nextStep(o: NgoOpportunity): { label: string; urgent: boolean } {
  if (!o.open) return { label: "Closed", urgent: false };
  if (!o.response) return { label: "Invited — respond with a proposal", urgent: true };
  if (o.response.status === "CHANGES_REQUESTED") return { label: "Changes requested — revise your proposal", urgent: true };
  if (o.response.status === "INTERESTED") return { label: "Interest recorded — submit a full proposal", urgent: true };
  return { label: NGO_RESPONSE_STATUS_LABELS[o.response.status as keyof typeof NGO_RESPONSE_STATUS_LABELS] ?? o.response.status, urgent: false };
}

export default async function MatchInboxPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "NGO") {
    redirect("/login");
  }

  // Owner or team member: the inbox belongs to the organisation.
  const membership = await resolveNgoMembership(session.user.id);
  if (!membership) {
    redirect("/ngo/register");
  }
  const profile = { id: membership.ngoId };

  // CSR requirement invitations (NGO-005): a donor/admin shared a sanitized
  // brief with one of this NGO's projects and is waiting for a proposal.
  const actor = await getActor();
  const invitations = actor ? await listOpportunitiesForNgo(actor).catch(() => [] as NgoOpportunity[]) : [];
  const actionNeeded = invitations.filter((o) => nextStep(o).urgent).length;

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
    <main className="py-12">
      <div className="max-w-6xl mx-auto px-6">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white mb-2">Match Inbox</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          Review funding opportunities from CSRs matched to your projects by our Eligibility Engine.
        </p>
        
        <section className="mb-10 space-y-3" aria-labelledby="csr-invitations">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="csr-invitations" className="text-xl font-bold text-gray-900 dark:text-white">
              CSR invitations to propose
              {actionNeeded > 0 && (
                <span className="ml-2 align-middle text-xs font-bold px-2 py-0.5 rounded-full bg-trust-600 text-white">{actionNeeded} need action</span>
              )}
            </h2>
            <Link href="/ngo/opportunities" className="text-xs font-semibold text-emerald-600 hover:underline">
              All CSR opportunities →
            </Link>
          </div>
          {invitations.length === 0 ? (
            <p className="text-sm text-gray-500 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl py-6 text-center">
              No CSR invitations yet. When a donor&apos;s validated requirement matches one of your projects and you are invited, it appears here.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900">
              {invitations.map((o) => {
                const step = nextStep(o);
                return (
                  <li key={o.brief.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white">{o.brief.title}</p>
                      <p className="text-xs text-gray-500">
                        {o.brief.sector ?? "Sector not stated"} · {[o.brief.district, o.brief.state].filter(Boolean).join(", ") || "Location not stated"} ·{" "}
                        {formatBudgetRange(o.brief.budgetMin, o.brief.budgetMax)} · for {o.invitedProjects.map((p) => p.title).join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-semibold ${step.urgent ? "text-emerald-600" : "text-gray-500"}`}>{step.label}</span>
                      <Link
                        href={`/ngo/opportunities/${o.brief.id}${step.urgent ? "#respond" : ""}`}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${step.urgent ? "bg-trust-600 hover:bg-trust-700 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100"}`}
                      >
                        {step.urgent ? "Respond" : "View"}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Funder opportunities shortlisted for you</h2>
        <MatchInboxClient opportunities={opportunities} ngoId={profile.id} />
      </div>
    </main>
  );
}
