import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { effectiveAdminRole } from "@/lib/admin-roles";
import { listGrants, MAX_MINUTES } from "@/lib/break-glass";
import BreakGlassClient from "./BreakGlassClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ADM-020: request, list and revoke break-glass grants. */
export default async function BreakGlassPage({ searchParams }: { searchParams: { orgType?: string; orgId?: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/unauthorized");
  const role = effectiveAdminRole(session.user.adminRole);
  const grants = await listGrants(session.user);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Break-glass access</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
            Support admins can open time-boxed access (at most {MAX_MINUTES} minutes) to one organisation&apos;s admin data,
            with a written reason. The grant ends on its own; the holder or a super admin can end it early. Every page view and
            change made under a grant is written to the audit trail as <code>BREAK_GLASS_ACTION</code>.
          </p>
        </div>
        <BreakGlassClient
          role={role}
          selfId={session.user.id}
          grants={grants}
          prefill={{ orgType: searchParams.orgType === "DONOR" ? "DONOR" : "NGO", orgId: typeof searchParams.orgId === "string" ? searchParams.orgId : "" }}
        />
      </div>
    </div>
  );
}
