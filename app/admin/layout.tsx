import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import AdminShell from "./components/AdminShell";

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
  try {
    [pendingProjectCount, unresolvedAlertsTotal, inquiriesNeedingResponse, fieldsNeedingReview, pendingRequirementCount] = await Promise.all([
      prisma.project.count({ where: { status: "PENDING_APPROVAL", isDeleted: false } }),
      prisma.fraudAlert.count({ where: { resolved: false } }),
      // NGO has written back (reply or new appeal) and is waiting on the admin.
      prisma.reviewThread.count({ where: { status: "NGO_RESPONDED" } }),
      // Extracted fields awaiting the human gate, for NGOs still pending review.
      prisma.extractedField.count({
        where: { status: "NEEDS_REVIEW", ngo: { verificationStatus: "PENDING", isDeleted: false } },
      }),
      // Donor CSR requirements waiting on admin validation. The funder-led
      // proposal queue is gone from the nav (it belongs to the donor now), but
      // validating a requirement is still admin's gate.
      prisma.sponsorRequirement.count({ where: { status: "PENDING_ADMIN_REVIEW" } }),
    ]);
  } catch (err) {
    // Nav badges are a nice-to-have — a schema/connection hiccup here must not
    // take down every admin page (individual pages already surface DB errors).
    console.error("[admin-layout] failed to load nav badge counts:", err);
  }

  // Counts belong to a hub, not to a page inside it: the badge answers "which
  // hub needs me", and the tab strip inside answers "which part of it".
  const badges: Record<string, number> = {
    verification: fieldsNeedingReview + pendingRequirementCount,
    campaigns: pendingProjectCount,
    risk: unresolvedAlertsTotal,
    people: inquiriesNeedingResponse,
  };

  return (
    <AdminShell
      adminRole={session.user.adminRole ?? null}
      userName={session.user.name ?? null}
      userEmail={session.user.email ?? null}
      badges={badges}
    >
      {children}
    </AdminShell>
  );
}
