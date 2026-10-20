import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { donorCan, resolveDonorAccount } from "@/lib/donor-team";
import { listTeam } from "@/lib/donor-team-admin";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";

/** The donor organisation's CSR team: who acts for the account, and as what. */
export default async function DonorTeamPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/donor/team");
  if (session.user.role !== "DONOR") redirect("/unauthorized");

  const account = await resolveDonorAccount(session.user.id);
  const team = await listTeam(account.accountId);
  return (
    <TeamClient
      team={team}
      myUserId={session.user.id}
      myRole={account.role}
      canManage={donorCan(account.role, "manageTeam")}
    />
  );
}
