import prisma from "@/lib/prisma";
import { loadReportFigures, serializeReport } from "@/lib/contract-impact-reports";
import { serializeStory } from "@/lib/impact-story-service";
import PublishingClient from "./PublishingClient";

export const dynamic = "force-dynamic";

/**
 * Admin publishing queue (ADM-015 / NGO-017): stored funder reports SUBMITTED
 * by NGOs and impact stories IN_REVIEW. Nothing reaches a donor or the public
 * until a decision here. The admin layout gates the page; the PATCH routes
 * re-check the role.
 */
export default async function ImpactPublishingPage() {
  const [reports, stories] = await Promise.all([
    prisma.contractImpactReport.findMany({ where: { status: "SUBMITTED" }, orderBy: { submittedAt: "asc" }, take: 50 }),
    prisma.impactStory.findMany({ where: { status: "IN_REVIEW" }, orderBy: { submittedAt: "asc" }, take: 50 }),
  ]);
  const ngoIds = Array.from(new Set([...reports.map((r) => r.ngoId), ...stories.map((s) => s.ngoId)]));
  const ngos = ngoIds.length ? await prisma.nGOProfile.findMany({ where: { id: { in: ngoIds } }, select: { id: true, orgName: true } }) : [];
  const orgName = new Map(ngos.map((n) => [n.id, n.orgName]));

  const reportRows = await Promise.all(
    reports.map(async (r) => ({ ...serializeReport(r), orgName: orgName.get(r.ngoId) ?? "—", figures: (await loadReportFigures(r)).figures })),
  );
  const storyRows = stories.map((s) => ({ ...serializeStory(s), orgName: orgName.get(s.ngoId) ?? "—" }));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Impact publishing</h1>
        <p className="text-sm text-gray-500">Review funder reports and impact stories before they are published.</p>
      </header>
      <PublishingClient reports={JSON.parse(JSON.stringify(reportRows))} stories={storyRows} />
    </div>
  );
}
