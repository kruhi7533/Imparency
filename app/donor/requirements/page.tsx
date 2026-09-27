import { redirect } from "next/navigation";
import { getActor } from "@/lib/requirements/access";
import { listRequirementsForActor } from "@/lib/requirements/queries";
import { checkFunderEligibility } from "@/lib/matching/funder";
import RequirementsWorkspaceClient from "./RequirementsWorkspaceClient";

export const dynamic = "force-dynamic";

/** "My CSR Documents" — only the signed-in donor's own requirements. */
export default async function DonorRequirementsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login?callbackUrl=/donor/requirements");
  const [items, funder] = await Promise.all([listRequirementsForActor(actor), checkFunderEligibility(actor.id)]);
  // SPEC-1: the same gate the API enforces, shown up front so a donor is not
  // left to discover it after filling in the whole form.
  const gate = funder.ok ? null : { reason: funder.reason ?? "NOT_VERIFIED", message: funder.message ?? "" };
  return <RequirementsWorkspaceClient items={items} gate={gate} />;
}
