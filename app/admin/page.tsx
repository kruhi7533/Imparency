import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { adminHome } from "@/lib/admin-roles";

// /admin had no page and answered 404. The console's home is the dashboard for
// super admins and auditors; restricted sub-roles land on the page they can
// open (lib/admin-roles.ts adminHome). The layout has already gated the role.
export default async function AdminIndex() {
  const session = await getServerSession(authOptions);
  redirect(adminHome(session?.user?.adminRole ?? null));
}
