import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getActor, loadRequirementForActor } from "@/lib/requirements/access";
import { serializeRequirement, serializeMatchRun } from "@/lib/requirements/dto";
import { listResponses } from "@/lib/requirements/queries";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import { getLatestMatchRun } from "@/src/agents/gap-diagnoser/services/gapAnalysisService";
import RequirementDetailClient from "./RequirementDetailClient";

export const dynamic = "force-dynamic";

export default async function DonorRequirementDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string; duplicate?: string; created?: string };
}) {
  const actor = await getActor();
  if (!actor) redirect(`/login?callbackUrl=/donor/requirements/${params.id}`);

  let requirement;
  try {
    requirement = await loadRequirementForActor(params.id, actor, {
      revisions: { orderBy: { version: "desc" as const }, include: { changedBy: { select: { name: true, email: true } } } },
    });
  } catch (err) {
    // Not found and not-yours look the same to the visitor.
    if (err instanceof RequirementWorkflowError) notFound();
    throw err;
  }

  const [run, responses, contract] = await Promise.all([
    getLatestMatchRun(params.id, actor),
    listResponses(params.id),
    requirement.status === "CONTRACTED"
      ? prisma.contract.findFirst({ where: { requirementId: params.id }, select: { id: true, contractNumber: true, status: true } })
      : null,
  ]);

  return (
    <>
    <TeamRoleBanner role={actor.donorRole} />
    <RequirementDetailClient
      requirement={serializeRequirement(requirement, { includeRawText: true })}
      matchRun={run ? serializeMatchRun(run, { forDonor: true }) : null}
      responses={responses}
      contract={contract}
      initialTab={searchParams.tab}
      duplicate={searchParams.duplicate === "1"}
      created={searchParams.created === "1"}
    />
    </>
  );
}

function TeamRoleBanner({ role }: { role?: string }) {
  if (role !== "VIEWER" && role !== "APPROVER") return null;
  return (
    <p role="note" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
      {role === "VIEWER"
        ? "You have view-only access to your organisation's CSR work. Ask an owner or admin to make changes."
        : "As an approver you can run matching, review proposals and approve them. Editing the requirement itself is for owners and admins."}
    </p>
  );
}

