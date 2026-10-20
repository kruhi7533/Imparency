import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { loadNgoImpactCockpit } from "@/lib/outcome-cockpit";
import ImpactCockpitClient from "./ImpactCockpitClient";

export const dynamic = "force-dynamic";

/**
 * NGO impact cockpit (Week 8, NGO track): report outcomes against the governed
 * Metric Registry, cite approved evidence, see the reviewer's verdict before
 * submitting, and track every claim through review.
 *
 * Filing and editing claims is the owner's (the claim API is owner-only); team
 * members see the same cockpit read-only.
 */
export default async function NgoImpactPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/ngo/impact");
  if (session.user.role !== "NGO") redirect("/unauthorized");

  const owned = await prisma.nGOProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, verificationStatus: true },
  });
  const member = owned
    ? null
    : await prisma.nGOTeamMember.findFirst({ where: { userId: session.user.id }, select: { ngoId: true } });
  const ngoId = owned?.id ?? member?.ngoId;
  if (!ngoId) redirect("/ngo/register");

  const cockpit = await loadNgoImpactCockpit(ngoId);
  return (
    <ImpactCockpitClient
      cockpit={JSON.parse(JSON.stringify(cockpit))}
      canEdit={!!owned}
      verified={owned ? owned.verificationStatus === "VERIFIED" : true}
    />
  );
}
