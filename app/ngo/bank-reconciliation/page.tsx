import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { loadReconciliationView } from "@/lib/bank-statement";
import { getNgoMembership, ngoCan } from "@/lib/tenant-scope";
import BankReconciliationClient from "./BankReconciliationClient";

export const dynamic = "force-dynamic";

/** NGO: match donor-recorded contract payments against the organisation's own bank statement. */
export default async function BankReconciliationPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/ngo/bank-reconciliation");
  if (session.user.role !== "NGO") redirect("/unauthorized");
  // Finance data: OWNER/ADMIN/FINANCE only (lib/tenant-scope.ts).
  const member = await getNgoMembership(session.user.id);
  if (member && !ngoCan(member.teamRole, "finance")) redirect("/unauthorized");
  const view = await loadReconciliationView(session.user);
  if (!view) redirect("/ngo/register");
  return <BankReconciliationClient view={view} />;
}
