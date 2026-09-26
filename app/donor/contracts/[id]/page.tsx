import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import ContractDetailClient from "@/app/donor/contracts/[id]/ContractDetailClient";

export const dynamic = "force-dynamic";

export default async function DonorContractDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect(`/login?callbackUrl=/donor/contracts/${params.id}`);
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
    },
  });

  if (!contract) {
    notFound();
  }

  // Check access
  if (userRole === "DONOR" && contract.donorId !== userId) {
    notFound();
  }
  if (userRole === "NGO" && contract.ngo.userId !== userId) {
    const isMember = await prisma.nGOTeamMember.findFirst({
      where: { userId, ngoId: contract.ngoId },
    });
    if (!isMember) notFound();
  }

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
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <ContractDetailClient
          contract={serializedContract}
          currentUser={{
            id: userId,
            role: userRole,
            name: session.user.name || "Signatory",
            email: session.user.email || "",
          }}
        />
      </div>
    </div>
  );
}
