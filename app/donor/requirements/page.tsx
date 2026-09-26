import { redirect } from "next/navigation";
import { getActor } from "@/lib/requirements/access";
import { listRequirementsForActor } from "@/lib/requirements/queries";
import RequirementsWorkspaceClient from "./RequirementsWorkspaceClient";

export const dynamic = "force-dynamic";

/** "My CSR Documents" — only the signed-in donor's own requirements. */
export default async function DonorRequirementsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login?callbackUrl=/donor/requirements");
  const items = await listRequirementsForActor(actor);
  return <RequirementsWorkspaceClient items={items} />;
}
