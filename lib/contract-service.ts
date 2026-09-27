import prisma from "@/lib/prisma";
import { ContractStatus, ContractMilestoneStatus } from "@prisma/client";
import { commitRequirementChange } from "@/lib/requirements/commit";

export function generateContractNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 7).replace("-", ""); // e.g. 202609
  const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
  const timestampPart = Date.now().toString(36).slice(-3).toUpperCase();
  return `CTR-${dateStr}-${randomHex}${timestampPart}`;
}

export interface CreateContractParams {
  donorId: string;
  ngoId: string;
  projectId: string;
  requirementId?: string | null;
  title: string;
  description?: string | null;
  totalGrantAmount: number;
  currency?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  csrScheduleViiCategory?: string | null;
  reportingCadence?: string;
  termsAndConditions: string;
  milestones: Array<{
    title: string;
    description: string;
    allocatedAmount: number;
    deliverables?: string[];
    dueDate?: Date | null;
    projectMilestoneId?: string | null;
    orderIndex?: number;
  }>;
  actorId: string;
  actorRole: "DONOR" | "NGO" | "ADMIN";
}

export async function createContract(params: CreateContractParams) {
  const contractNumber = generateContractNumber();

  // Validate milestones sum against totalGrantAmount
  const milestoneSum = params.milestones.reduce((acc, m) => acc + m.allocatedAmount, 0);
  if (Math.abs(milestoneSum - params.totalGrantAmount) > 0.01) {
    throw new Error(
      `Sum of milestone allocations (${milestoneSum}) must equal the total grant amount (${params.totalGrantAmount}).`
    );
  }

  // Create contract, milestones, and audit log in a transaction
  return await prisma.$transaction(async (tx) => {
    // A linked CSR requirement must have been awarded to exactly this donor,
    // NGO and project (SELECTED). Linking moves it to CONTRACTED atomically, so
    // a requirement can back only one contract.
    const requirement = params.requirementId
      ? await tx.sponsorRequirement.findUnique({ where: { id: params.requirementId } })
      : null;
    if (params.requirementId) {
      if (!requirement) throw new Error("Linked CSR requirement not found.");
      if (requirement.sponsorId !== params.donorId) {
        throw new Error("The linked CSR requirement belongs to a different donor.");
      }
      if (
        requirement.status !== "SELECTED" ||
        requirement.selectedProjectId !== params.projectId ||
        requirement.selectedNgoId !== params.ngoId
      ) {
        throw new Error("A contract can only be linked to a CSR requirement whose selected NGO project matches this contract.");
      }
    }

    const contract = await tx.contract.create({
      data: {
        contractNumber,
        donorId: params.donorId,
        ngoId: params.ngoId,
        projectId: params.projectId,
        requirementId: params.requirementId || null,
        title: params.title,
        description: params.description || null,
        status: ContractStatus.DRAFT,
        totalGrantAmount: params.totalGrantAmount,
        currency: params.currency || "INR",
        startDate: params.startDate || null,
        endDate: params.endDate || null,
        csrScheduleViiCategory: params.csrScheduleViiCategory || null,
        reportingCadence: params.reportingCadence || "QUARTERLY",
        termsAndConditions: params.termsAndConditions,
        milestones: {
          create: params.milestones.map((m, idx) => ({
            title: m.title,
            description: m.description,
            allocatedAmount: m.allocatedAmount,
            status: ContractMilestoneStatus.PENDING,
            deliverables: m.deliverables || [],
            dueDate: m.dueDate || null,
            projectMilestoneId: m.projectMilestoneId || null,
            orderIndex: m.orderIndex ?? idx,
          })),
        },
        auditLogs: {
          create: {
            action: "CREATED",
            actorId: params.actorId,
            actorRole: params.actorRole,
            detail: `Contract draft ${contractNumber} created with total grant of ₹${params.totalGrantAmount.toLocaleString("en-IN")}.`,
          },
        },
      },
      include: {
        milestones: { orderBy: { orderIndex: "asc" } },
        auditLogs: true,
      },
    });

    if (requirement) {
      await commitRequirementChange(tx, requirement, {
        actorId: params.actorId,
        actorRole: params.actorRole,
        toStatus: "CONTRACTED",
        audit: {
          action: "CONTRACT_INITIATED",
          detail: `Grant contract ${contractNumber} drafted for the selected NGO.`,
          metadata: { contractId: contract.id, projectId: params.projectId, ngoId: params.ngoId },
        },
      });
    }

    return contract;
  });
}

export async function proposeContract(params: {
  contractId: string;
  actorId: string;
  actorRole: "DONOR" | "NGO" | "ADMIN";
  note?: string;
}) {
  const contract = await prisma.contract.findUnique({
    where: { id: params.contractId },
    include: { milestones: true },
  });

  if (!contract) {
    throw new Error("Contract not found");
  }

  if (contract.status !== ContractStatus.DRAFT && contract.status !== ContractStatus.UNDER_REVIEW) {
    throw new Error(`Cannot propose a contract that is currently in ${contract.status} status.`);
  }

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.contract.update({
      where: { id: params.contractId },
      data: {
        status: ContractStatus.PROPOSED,
        auditLogs: {
          create: {
            action: "PROPOSED",
            actorId: params.actorId,
            actorRole: params.actorRole,
            detail: params.note || "Contract terms submitted for formal review.",
          },
        },
      },
      include: { milestones: true, auditLogs: true },
    });

    return updated;
  });
}

export async function signContract(params: {
  contractId: string;
  actorId: string;
  actorRole: "DONOR" | "NGO";
  signerName: string;
  signerTitle: string;
  signerIp: string;
  note?: string;
}) {
  const contract = await prisma.contract.findUnique({
    where: { id: params.contractId },
    include: { donor: true, ngo: true },
  });

  if (!contract) {
    throw new Error("Contract not found");
  }

  if (
    contract.status !== ContractStatus.PROPOSED &&
    contract.status !== ContractStatus.UNDER_REVIEW &&
    contract.status !== ContractStatus.DRAFT
  ) {
    throw new Error(`Cannot sign a contract in ${contract.status} status.`);
  }

  const isDonor = params.actorRole === "DONOR";
  const now = new Date();

  const updateData: any = {};
  if (isDonor) {
    updateData.donorSignedAt = now;
    updateData.donorSignedByName = params.signerName;
    updateData.donorSignerTitle = params.signerTitle;
    updateData.donorSignerIp = params.signerIp;
  } else {
    updateData.ngoSignedAt = now;
    updateData.ngoSignedByName = params.signerName;
    updateData.ngoSignerTitle = params.signerTitle;
    updateData.ngoSignerIp = params.signerIp;
  }

  // Check if this signature completes bilateral execution
  const donorWillBeSigned = isDonor || contract.donorSignedAt !== null;
  const ngoWillBeSigned = !isDonor || contract.ngoSignedAt !== null;
  const isFullyExecuted = donorWillBeSigned && ngoWillBeSigned;

  if (isFullyExecuted) {
    updateData.status = ContractStatus.ACTIVE;
    if (!contract.startDate) {
      updateData.startDate = now;
    }
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Record the party signature audit log
    await tx.contractAuditLog.create({
      data: {
        contractId: params.contractId,
        action: isDonor ? "DONOR_SIGNED" : "NGO_SIGNED",
        actorId: params.actorId,
        actorRole: params.actorRole,
        detail: `Signed electronically by ${params.signerName} (${params.signerTitle}) from IP ${params.signerIp}.`,
        metadata: { signerName: params.signerName, signerTitle: params.signerTitle, ip: params.signerIp },
      },
    });

    // 2. If activated, record ACTIVATED log
    if (isFullyExecuted) {
      await tx.contractAuditLog.create({
        data: {
          contractId: params.contractId,
          action: "ACTIVATED",
          actorId: params.actorId,
          actorRole: params.actorRole,
          detail: "Contract is fully executed by both parties and is now ACTIVE.",
        },
      });
    }

    // 3. Update contract record
    const updated = await tx.contract.update({
      where: { id: params.contractId },
      data: updateData,
      include: {
        milestones: { orderBy: { orderIndex: "asc" } },
        auditLogs: { orderBy: { createdAt: "desc" } },
        donor: { select: { id: true, name: true, email: true, companyName: true } },
        ngo: { select: { id: true, orgName: true, panNumber: true, logo_url: true } },
        project: { select: { id: true, title: true, location: true } },
      },
    });

    return updated;
  });
}

export async function disburseMilestone(params: {
  contractId: string;
  milestoneId: string;
  actorId: string;
  actorRole: "DONOR" | "ADMIN";
  note?: string;
}) {
  const contract = await prisma.contract.findUnique({
    where: { id: params.contractId },
    include: { milestones: true },
  });

  if (!contract) {
    throw new Error("Contract not found");
  }

  if (contract.status !== ContractStatus.ACTIVE) {
    throw new Error(`Cannot disburse funds for a contract in ${contract.status} status.`);
  }

  const milestone = contract.milestones.find((m) => m.id === params.milestoneId);
  if (!milestone) {
    throw new Error("Contract milestone not found");
  }

  if (milestone.status === ContractMilestoneStatus.DISBURSED) {
    throw new Error("This milestone has already been disbursed.");
  }

  return await prisma.$transaction(async (tx) => {
    await tx.contractMilestone.update({
      where: { id: params.milestoneId },
      data: {
        status: ContractMilestoneStatus.DISBURSED,
        completedAt: new Date(),
      },
    });

    await tx.contractAuditLog.create({
      data: {
        contractId: params.contractId,
        action: "FUNDS_DISBURSED",
        actorId: params.actorId,
        actorRole: params.actorRole,
        detail: `Milestone "${milestone.title}" marked as DISBURSED (₹${Number(milestone.allocatedAmount).toLocaleString("en-IN")}). ${params.note || ""}`.trim(),
        metadata: { milestoneId: params.milestoneId, amount: Number(milestone.allocatedAmount) },
      },
    });

    // Check if all milestones are now disbursed -> mark Contract as COMPLETED
    const remainingUndisbursed = await tx.contractMilestone.count({
      where: {
        contractId: params.contractId,
        status: { not: ContractMilestoneStatus.DISBURSED },
      },
    });

    if (remainingUndisbursed === 0) {
      await tx.contract.update({
        where: { id: params.contractId },
        data: { status: ContractStatus.COMPLETED },
      });

      await tx.contractAuditLog.create({
        data: {
          contractId: params.contractId,
          action: "COMPLETED",
          actorId: params.actorId,
          actorRole: params.actorRole,
          detail: "All contract milestones have been disbursed and fulfilled. Contract marked as COMPLETED.",
        },
      });
    }

    return await tx.contract.findUnique({
      where: { id: params.contractId },
      include: {
        milestones: { orderBy: { orderIndex: "asc" } },
        auditLogs: { orderBy: { createdAt: "desc" } },
      },
    });
  });
}

export async function terminateContract(params: {
  contractId: string;
  actorId: string;
  actorRole: "DONOR" | "NGO" | "ADMIN";
  reason: string;
}) {
  const contract = await prisma.contract.findUnique({
    where: { id: params.contractId },
  });

  if (!contract) {
    throw new Error("Contract not found");
  }

  if (contract.status === ContractStatus.COMPLETED || contract.status === ContractStatus.TERMINATED) {
    throw new Error(`Cannot terminate a contract that is already ${contract.status}.`);
  }

  return await prisma.$transaction(async (tx) => {
    await tx.contractAuditLog.create({
      data: {
        contractId: params.contractId,
        action: "TERMINATED",
        actorId: params.actorId,
        actorRole: params.actorRole,
        detail: `Contract terminated: ${params.reason}`,
        metadata: { reason: params.reason },
      },
    });

    const updated = await tx.contract.update({
      where: { id: params.contractId },
      data: {
        status: ContractStatus.TERMINATED,
      },
      include: {
        milestones: { orderBy: { orderIndex: "asc" } },
        auditLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    return updated;
  });
}
