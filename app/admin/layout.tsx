import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import AdminNav from "./components/AdminNav";

export const runtime = "nodejs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");

  let pendingProjectCount = 0;
  let unresolvedAlertsTotal = 0;
  let inquiriesNeedingResponse = 0;
  try {
    [pendingProjectCount, unresolvedAlertsTotal, inquiriesNeedingResponse] = await Promise.all([
      prisma.project.count({ where: { status: "PENDING_APPROVAL", isDeleted: false } }),
      prisma.fraudAlert.count({ where: { resolved: false } }),
      // NGO has written back (reply or new appeal) and is waiting on the admin.
      prisma.reviewThread.count({ where: { status: "NGO_RESPONDED" } }),
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
      />
      {children}
    </div>
  );
}
