import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/requirements/access";
import { getOpportunityForNgo } from "@/lib/requirements/opportunities";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import OpportunityClient from "./OpportunityClient";

export const dynamic = "force-dynamic";

export default async function NgoOpportunityPage({ params }: { params: { id: string } }) {
  const actor = await getActor();
  if (!actor || actor.role !== "NGO") redirect(`/login?callbackUrl=/ngo/opportunities/${params.id}`);

  try {
    const opportunity = await getOpportunityForNgo(params.id, actor);
    return <OpportunityClient opportunity={opportunity} />;
  } catch (err) {
    if (err instanceof RequirementWorkflowError) notFound();
    throw err;
  }
}
