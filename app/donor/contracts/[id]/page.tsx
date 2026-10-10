import ContractPageContent from "./ContractPageContent";

export const dynamic = "force-dynamic";

export default function DonorContractDetailPage({ params }: { params: { id: string } }) {
  return <ContractPageContent contractId={params.id} loginPath={`/donor/contracts/${params.id}`} />;
}
