import prisma from "@/lib/prisma";
import { ContractStatus, ContractMilestoneStatus, Prisma } from "@prisma/client";

/**
 * A rupee amount from a request: a plain non-negative number with at most two
 * decimal places, as a number or a string ("120000", "1,20,000.50").
 * Returns an exact Decimal, or null when it is not a valid amount. Money never
 * goes through a float here — 0.1 + 0.2 must not decide whether milestones add
 * up to a grant.
 */
export function parseRupees(v: unknown): Prisma.Decimal | null {
  const raw = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim().replace(/,/g, "") : "";
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(raw)) return null;
  return new Prisma.Decimal(raw);
}
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
  totalGrantAmount: Prisma.Decimal;
  currency?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  csrScheduleViiCategory?: string | null;
  reportingCadence?: string;
  termsAndConditions: string;
  milestones: Array<{
    title: string;
    description: string;
    allocatedAmount: Prisma.Decimal;
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

  // Milestone allocations must add up to the grant exactly, to the paisa.
  if (params.totalGrantAmount.lte(0)) throw new Error("The total grant amount must be greater than zero.");
  const milestoneSum = params.milestones.reduce((acc, m) => acc.plus(m.allocatedAmount), new Prisma.Decimal(0));
  if (!milestoneSum.equals(params.totalGrantAmount)) {
    throw new Error(
      `Sum of milestone allocations (${milestoneSum.toFixed(2)}) must equal the total grant amount (${params.totalGrantAmount.toFixed(2)}).`
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
    } else {
      // NEG-007: an "independent" contract must not become a side door around
      // CSR selection. If this donor has an open CSR requirement in which this
      // project is still competing (shortlisted / responding — no approved
      // proposal yet), the contract has to wait for that selection and then be
      // created against the requirement, so it is bound to the approved version.
      const pending = await tx.opportunityResponse.findFirst({
        where: {
          projectId: params.projectId,
          requirement: { sponsorId: params.donorId, status: { in: ["SHORTLISTED", "NGO_RESPONSE", "SELECTED"] } },
        },
        select: { requirementId: true, requirement: { select: { status: true } } },
      });
      if (pending) {
        throw new Error(
          pending.requirement.status === "SELECTED"
            ? "This project's proposal was approved on one of your CSR requirements — create the contract from that requirement so it is bound to the approved proposal."
            : "This project is still under consideration on one of your CSR requirements. Approve its proposal first; the contract is then created from the requirement."
        );
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
            detail: `Contract draft ${contractNumber} created with total grant of ₹${Number(params.totalGrantAmount.toFixed(2)).toLocaleString("en-IN")}.`,
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
