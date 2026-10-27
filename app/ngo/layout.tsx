import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getNgoAttentionCounts, type NgoAttentionCounts } from "@/lib/ngo-attention";
import NgoSidebarShell from "./NgoSidebarShell";

// Pages under /ngo keep their own auth and ownership checks; this layout only
// adds the portal sidebar (for signed-in NGO users) so every NGO section is
// one click away. Public pages such as /ngo/[id] render bare for everyone else.
export default async function NgoLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== "NGO") return <>{children}</>;

  const teamRole = session.user.ngoTeamRole ?? "OWNER";
  const ngoId = session.user.ngoProfileId ?? null;

  // Badge counts are a convenience: a failed query shows no badge rather than
  // breaking every NGO page.
  let counts: NgoAttentionCounts | null = null;
  let orgName: string | null = null;
  if (ngoId) {
    const [c, org] = await Promise.all([
      getNgoAttentionCounts(ngoId).catch(() => null),
      prisma.nGOProfile.findUnique({ where: { id: ngoId }, select: { orgName: true } }).catch(() => null),
    ]);
    counts = c;
    orgName = org?.orgName ?? null;
  }

  return (
    <NgoSidebarShell teamRole={teamRole} userName={session.user.name ?? "NGO"} orgName={orgName} counts={counts}>
      {children}
    </NgoSidebarShell>
  );
}
