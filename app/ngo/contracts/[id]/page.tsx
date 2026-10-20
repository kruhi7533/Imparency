import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import ContractPageContent from "@/app/donor/contracts/[id]/ContractPageContent";

export const dynamic = "force-dynamic";

/** The NGO's route to its grant contract: review, counter-sign, accept the project, confirm payments. */
export default async function NgoContractDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (session?.user && session.user.role !== "NGO") redirect("/unauthorized");
  return <ContractPageContent contractId={params.id} loginPath={`/ngo/contracts/${params.id}`} />;
}
