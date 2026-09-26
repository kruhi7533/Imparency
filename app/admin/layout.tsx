import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import AdminNav from "./components/AdminNav";
import AdminTabs from "./components/AdminTabs";

export const runtime = "nodejs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  let pendingProjectCount = 0;
  let unresolvedAlertsTotal = 0;
  let inquiriesNeedingResponse = 0;
  let pendingRequirementCount = 0;
  let fieldsNeedingReview = 0;
  let proposalsAwaitingDecision = 0;
  try {
    [pendingProjectCount, unresolvedAlertsTotal, inquiriesNeedingResponse, fieldsNeedingReview, proposalsAwaitingDecision, pendingRequirementCount] = await Promise.all([
      prisma.project.count({ where: { status: "PENDING_APPROVAL", isDeleted: false } }),
      prisma.fraudAlert.count({ where: { resolved: false } }),
      // NGO has written back (reply or new appeal) and is waiting on the admin.
      prisma.reviewThread.count({ where: { status: "NGO_RESPONDED" } }),
      // Extracted fields awaiting the human gate, for NGOs still pending review.
      prisma.extractedField.count({
        where: { status: "NEEDS_REVIEW", ngo: { verificationStatus: "PENDING", isDeleted: false } },
      }),
      // Proposals still needing an accept/reject — matches the "awaiting a
      // decision" count the Proposals page itself shows (SUBMITTED or UNDER_REVIEW).
      prisma.proposal.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      prisma.sponsorRequirement.count({ where: { status: "PENDING_ADMIN_REVIEW" } }),
    ]);
  } catch (err) {
    // Nav badges are a nice-to-have — a schema/connection hiccup here must not
    // take down every admin page (individual pages already surface DB errors).
    console.error("[admin-layout] failed to load nav badge counts:", err);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <AdminNav
        pendingProjectCount={pendingProjectCount}
        unresolvedAlertsTotal={unresolvedAlertsTotal}
        inquiriesNeedingResponse={inquiriesNeedingResponse}
        fieldsNeedingReview={fieldsNeedingReview}
        proposalsAwaitingDecision={proposalsAwaitingDecision}
        pendingRequirementCount={pendingRequirementCount}
      />
      {/* Second level. Renders itself only inside a hub — it works out which one
          from the path, so pages do not each have to declare their own tabs. */}
      <AdminTabs />
      {children}
    </div>
  );
}
