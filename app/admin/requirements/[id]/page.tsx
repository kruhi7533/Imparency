import { notFound, redirect } from "next/navigation";
import { getActor, loadRequirementForActor } from "@/lib/requirements/access";
import { serializeRequirement, serializeMatchRun } from "@/lib/requirements/dto";
import { listAuditTrail, listResponses } from "@/lib/requirements/queries";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import { getLatestMatchRun } from "@/src/agents/gap-diagnoser/services/gapAnalysisService";
import AdminRequirementClient from "./AdminRequirementClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminRequirementDetailPage({ params }: { params: { id: string } }) {
  const actor = await getActor();
  if (!actor || actor.role !== "ADMIN") redirect("/unauthorized");

  let requirement;
  try {
    requirement = await loadRequirementForActor(params.id, actor, {
      sponsor: { select: { id: true, name: true, email: true, companyName: true } },
      revisions: { orderBy: { version: "desc" as const }, include: { changedBy: { select: { name: true, email: true } } } },
    });
  } catch (err) {
    if (err instanceof RequirementWorkflowError) notFound();
    throw err;
  }

  const [run, responses, events] = await Promise.all([
    getLatestMatchRun(params.id, actor),
    listResponses(params.id),
    listAuditTrail(params.id),
  ]);

  return (
    <AdminRequirementClient
      requirement={serializeRequirement(requirement, { includeRawText: true })}
      matchRun={run ? serializeMatchRun(run) : null}
      responses={responses}
      events={events}
    />
  );
}
