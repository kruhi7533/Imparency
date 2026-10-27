import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import ContractDetailClient from "@/app/donor/contracts/[id]/ContractDetailClient";
import ContractImpactPanels from "@/components/contract/ContractImpactPanels";
import { fundingPanelProps, resolveContractParty } from "@/lib/contract-payments";
import { resolveDonorAccount } from "@/lib/donor-team";

/**
 * The grant-contract screen, shared by /donor/contracts/[id] and
 * /ngo/contracts/[id]. It used to exist only under /donor, which the donor
 * layout closes to every other role — so an NGO could never open the contract
 * to counter-sign it, the contract never became ACTIVE, and the NGO could
 * never accept the project or confirm a payment. Access is decided here, the
 * same way for both routes.
 */
export default async function ContractPageContent({ contractId, loginPath }: { contractId: string; loginPath: string }) {
  const params = { id: contractId };
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(`/login?callbackUrl=${loginPath}`);
  }

  const userId = session.user.id;
  const userRole = session.user.role;

  const contract = await (prisma as any).contract.findUnique({
    where: { id: params.id },
    include: {
      donor: {
        select: {
          id: true,
          name: true,
          email: true,
          companyName: true,
          isCorporate: true,
          gstNumber: true,
          donorPersona: true,
        },
      },
      ngo: {
        select: {
          id: true,
          orgName: true,
          panNumber: true,
          registrationNumber: true,
          logo_url: true,
          website: true,
          address: true,
          userId: true,
        },
      },
      project: {
        select: {
          id: true,
          title: true,
          description: true,
          location: true,
          coverImage: true,
          targetAmount: true,
          raisedAmount: true,
          causeCategory: true,
        },
      },
      milestones: {
        orderBy: { orderIndex: "asc" },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
      },
      payments: true,
      paymentAllocations: true,
    },
  });

  if (!contract) {
    notFound();
  }

  // Check access
  if (userRole === "DONOR" && (await resolveDonorAccount(userId)).accountId !== contract.donorId) {
    notFound();
  }
  if (userRole === "NGO" && contract.ngo.userId !== userId) {
    const isMember = await prisma.nGOTeamMember.findFirst({
      where: { userId, ngoId: contract.ngoId },
    });
    if (!isMember) notFound();
  }

  // Same ownership rule as the payment routes, so the panel never offers an
  // action the API would refuse.
  const party = await resolveContractParty({ id: userId, role: userRole }, contract);
  if (!party) notFound();
  const funding = fundingPanelProps(contract, party);

  const serializedContract = {
    ...contract,
    totalGrantAmount: Number(contract.totalGrantAmount),
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
    startDate: contract.startDate ? contract.startDate.toISOString() : null,
    endDate: contract.endDate ? contract.endDate.toISOString() : null,
    donorSignedAt: contract.donorSignedAt ? contract.donorSignedAt.toISOString() : null,
    ngoSignedAt: contract.ngoSignedAt ? contract.ngoSignedAt.toISOString() : null,
    project: {
      ...contract.project,
      targetAmount: Number(contract.project.targetAmount),
      raisedAmount: Number(contract.project.raisedAmount),
    },
    milestones: (contract.milestones || []).map((m: any) => ({
      ...m,
      allocatedAmount: Number(m.allocatedAmount),
      dueDate: m.dueDate ? m.dueDate.toISOString() : null,
      completedAt: m.completedAt ? m.completedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
    auditLogs: (contract.auditLogs || []).map((a: any) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
    payments: undefined,
    paymentAllocations: undefined,
    fundedAt: contract.fundedAt ? contract.fundedAt.toISOString() : null,
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <ContractDetailClient
          contract={serializedContract}
          funding={funding}
          currentUser={{
            id: userId,
            role: userRole,
            name: session.user.name || "Signatory",
            email: session.user.email || "",
          }}
        />
        {(contract.status === "ACTIVE" || contract.status === "COMPLETED") && (
          <ContractImpactPanels
            contractId={contract.id}
            projectId={contract.projectId}
            role={userRole}
            milestones={(contract.milestones || []).map((m: any) => ({ id: m.id, title: m.title }))}
          />
        )}
      </div>
    </div>
  );
}
