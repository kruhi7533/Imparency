import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { resolveNgoActor } from "@/lib/field-evidence";
import ReportingClient from "./ReportingClient";

export const dynamic = "force-dynamic";

/**
 * NGO reporting hub: funders' renewal / next-opportunity requests, impact
 * stories (consent-filtered, admin-reviewed), and links to each contract's
 * stored impact reports and fund utilisation.
 */
export default async function NgoReportingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/ngo/reporting");
  if (session.user.role !== "NGO") redirect("/unauthorized");
  const actor = await resolveNgoActor(session.user.id);
  if (!actor) redirect("/ngo/register");

  const [projects, contracts] = await Promise.all([
    prisma.project.findMany({ where: { ngoId: actor.ngoId, isDeleted: false }, select: { id: true, title: true }, orderBy: { createdAt: "desc" } }),
    prisma.contract.findMany({
      where: { ngoId: actor.ngoId, status: { in: ["ACTIVE", "COMPLETED"] } },
      select: { id: true, title: true, contractNumber: true, projectId: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Reporting</h1>
          <p className="text-sm text-gray-500">Funder requests, impact stories, and per-contract reports and fund utilisation.</p>
        </header>
        <ReportingClient projects={projects} contracts={contracts} />
      </div>
    </div>
  );
}
