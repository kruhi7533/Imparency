import ContractPageContent from "@/app/donor/contracts/[id]/ContractPageContent";

export const dynamic = "force-dynamic";

/**
 * Admin view of a grant contract. The admin layout gates the route; access
 * inside is decided by ContractPageContent (resolveContractParty → ADMIN), the
 * same screen donors and NGOs see. Before this, admin links had to point at
 * /donor/contracts/[id], which the donor layout closes to every other role.
 */
export default function AdminContractPage({ params }: { params: { id: string } }) {
  return <ContractPageContent contractId={params.id} loginPath={`/admin/contracts/${params.id}`} />;
}
