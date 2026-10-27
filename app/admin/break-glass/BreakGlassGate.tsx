import Link from "next/link";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { effectiveAdminRole, type OrgRef } from "@/lib/admin-roles";
import { recordGrantUse } from "@/lib/break-glass";

/**
 * ADM-020 page gate for an organisation's admin detail page. SUPPORT admins
 * need a live grant for this org; each view under it is audited. Returns the
 * panel to render instead of the page, or null to render the page.
 */
export async function breakGlassPageGate(org: OrgRef): Promise<JSX.Element | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") return null; // the layout already handles these
  if (effectiveAdminRole(session.user.adminRole) !== "SUPPORT") return null;
  const path = org.orgType === "NGO" ? `/admin/ngos/${org.orgId}` : `/admin/donors/${org.orgId}`;
  const grantId = await recordGrantUse(session.user.id, org, { method: "GET", path });
  if (grantId) return null;
  return (
    <div className="py-16">
      <div className="max-w-xl mx-auto px-4 text-center space-y-4">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900">Break-glass access required</h1>
        <p className="text-sm text-gray-500">
          Support admins can open this organisation&apos;s admin record only under a time-boxed grant with a written reason.
          Every view and change under the grant is audited.
        </p>
        <Link
          href={`/admin/break-glass?orgType=${org.orgType}&orgId=${encodeURIComponent(org.orgId)}`}
          className="inline-block px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold"
        >
          Request access to this organisation
        </Link>
      </div>
    </div>
  );
}
