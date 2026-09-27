import React from "react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import NewContractClient from "@/app/donor/contracts/new/NewContractClient";
import { normalizeFields } from "@/lib/requirements/provenance";

export const dynamic = "force-dynamic";

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: { projectId?: string; requirementId?: string };
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DONOR") {
    redirect("/login?callbackUrl=/donor/contracts/new");
  }

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        session.user.id ? { id: session.user.id } : undefined,
        session.user.email ? { email: session.user.email } : undefined,
      ].filter(Boolean) as any,
    },
  });

  if (!user && session.user.email) {
    user = await prisma.user.create({
      data: {
        id: session.user.id || undefined,
        email: session.user.email,
        name: session.user.name || "Donor User",
        role: "DONOR",
        passwordHash: "oauth-or-session-restored",
      },
    });
  }

  const userId = user?.id || session.user.id;

  // Fetch verified active projects for Opportunity selection
  const projects = await prisma.project.findMany({
    where: {
      status: "ACTIVE",
      isDeleted: false,
      ngo: {
        verificationStatus: "VERIFIED",
        isSuspended: false,
      },
    },
    include: {
      ngo: {
        select: {
          id: true,
          orgName: true,
          panNumber: true,
          logo_url: true,
        },
      },
      milestones: {
        orderBy: { sequenceOrder: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          targetAmount: true,
          sequenceOrder: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Only CSR requirements that have been awarded to an NGO (SELECTED) can back
  // a contract; linking one moves it to CONTRACTED. The selected NGO's proposal
  // is used to prefill the agreement.
  const selectedRequirements = await prisma.sponsorRequirement.findMany({
    where: { sponsorId: userId, status: "SELECTED" },
    select: {
      id: true,
      fileName: true,
      extractedFields: true,
      selectedProjectId: true,
      responses: {
        where: { status: "SELECTED" },
        select: { projectId: true, proposedBudget: true, proposedDurationMonths: true, milestones: true },
        take: 1,
      },
    },
    orderBy: { selectedAt: "desc" },
  });

  const requirements = selectedRequirements.map((r) => {
    const fields = normalizeFields(r.extractedFields);
    const response = r.responses[0];
    return {
      id: r.id,
      fileName: r.fileName,
      sector: (fields.sector.value as string | null) ?? null,
      state: (fields.state.value as string | null) ?? null,
      reportingCadence: (fields.reportingCadence.value as string | null) ?? null,
      durationMonths: (fields.durationMonths.value as number | null) ?? response?.proposedDurationMonths ?? null,
      selectedProjectId: r.selectedProjectId,
      proposedBudget: response?.proposedBudget ? Number(response.proposedBudget) : null,
      proposedMilestones: Array.isArray(response?.milestones) ? (response!.milestones as any[]) : [],
    };
  });

  // Make sure every selected project is selectable even if it fell outside the list above.
  const missingProjectIds = requirements
    .map((r) => r.selectedProjectId)
    .filter((id): id is string => !!id && !projects.some((p) => p.id === id));
  if (missingProjectIds.length > 0) {
    const extra = await prisma.project.findMany({
      where: { id: { in: missingProjectIds } },
      include: {
        ngo: { select: { id: true, orgName: true, panNumber: true, logo_url: true } },
        milestones: {
          orderBy: { sequenceOrder: "asc" },
          select: { id: true, title: true, description: true, targetAmount: true, sequenceOrder: true },
        },
      },
    });
    projects.push(...(extra as typeof projects));
  }

  const serializedProjects = projects.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    causeCategory: p.causeCategory,
    targetAmount: Number(p.targetAmount),
    raisedAmount: Number(p.raisedAmount),
    location: p.location,
    ngo: p.ngo,
    milestones: p.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      targetAmount: Number(m.targetAmount),
      sequenceOrder: m.sequenceOrder,
    })),
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <NewContractClient
          projects={serializedProjects}
          requirements={requirements}
          initialProjectId={searchParams.projectId}
          initialRequirementId={searchParams.requirementId}
          donorUser={{
            name: session.user.name || "Donor Representative",
            email: session.user.email || "",
          }}
        />
      </div>
    </div>
  );
}
