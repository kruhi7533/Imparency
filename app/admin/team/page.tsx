import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ADMIN_ROLE_LABEL, effectiveAdminRole } from "@/lib/admin-roles";
import AdminTeamClient from "./AdminTeamClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin team and sub-roles. SUPER changes roles; AUDITOR sees the list read-only. */
export default async function AdminTeamPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");
  const myRole = effectiveAdminRole(session.user.adminRole);

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, adminRole: true },
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Admin team</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            Every admin has a sub-role. <strong>Finance</strong> works only in reconciliation, exceptions and payments.{" "}
            <strong>Auditor</strong> reads everything and can export the audit trail but cannot change anything.{" "}
            <strong>Support</strong> sees the queues; an organisation&apos;s admin data needs a time-boxed break-glass grant.
            Role changes take effect within a minute and are recorded in the audit trail.
          </p>
          <p className="mt-2 text-xs text-gray-400">You are: {ADMIN_ROLE_LABEL[myRole]}</p>
        </div>
        <AdminTeamClient
          canManage={myRole === "SUPER"}
          selfId={session.user.id}
          admins={admins.map((a) => ({ id: a.id, name: a.name, email: a.email, adminRole: effectiveAdminRole(a.adminRole) }))}
        />
      </div>
    </div>
  );
}
