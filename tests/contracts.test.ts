import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateContractNumber,
  createContract,
  proposeContract,
  signContract,
  disburseMilestone,
  terminateContract,
} from "@/lib/contract-service";

// Mock Prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    contract: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    contractMilestone: {
      update: vi.fn(),
      count: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    contractAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => {
      // Mock tx object with same methods
      const tx = {
        contract: {
          create: vi.fn(),
          update: vi.fn(),
          findUnique: vi.fn(),
        },
        contractMilestone: {
          update: vi.fn(),
          count: vi.fn(),
          createMany: vi.fn(),
          deleteMany: vi.fn(),
        },
        contractAuditLog: {
          create: vi.fn(),
        },
      };
      return await cb(tx);
    }),
  },
}));

import prisma from "@/lib/prisma";
const prismaMock = prisma as any;

describe("DonorOrg / Opportunity Contracts Subsystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateContractNumber", () => {
    it("generates a contract number matching the standard CTR format", () => {
      const num = generateContractNumber();
      expect(num).toMatch(/^CTR-\d{6}-[A-Z0-9]+$/);
    });
  });

  describe("createContract", () => {
    it("rejects creation if milestone allocations do not sum to total grant amount", async () => {
      const params = {
        donorId: "donor-123",
        ngoId: "ngo-456",
        projectId: "proj-789",
        title: "Test Education Grant",
        totalGrantAmount: 500000,
        termsAndConditions: "Standard CSR terms",
        milestones: [
          { title: "M1", description: "Desc 1", allocatedAmount: 200000 },
          { title: "M2", description: "Desc 2", allocatedAmount: 200000 }, // Total = 400,000 !== 500,000
        ],
        actorId: "donor-123",
        actorRole: "DONOR" as const,
      };

      await expect(createContract(params)).rejects.toThrow(/Sum of milestone allocations/);
    });

    it("successfully creates contract and initial audit log in transaction when balanced", async () => {
      const params = {
        donorId: "donor-123",
        ngoId: "ngo-456",
        projectId: "proj-789",
        title: "Test Healthcare Grant",
        totalGrantAmount: 500000,
        termsAndConditions: "Standard CSR terms",
        milestones: [
          { title: "M1", description: "Desc 1", allocatedAmount: 250000 },
          { title: "M2", description: "Desc 2", allocatedAmount: 250000 },
        ],
        actorId: "donor-123",
        actorRole: "DONOR" as const,
      };

      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          contract: {
            create: vi.fn().mockResolvedValue({
              id: "contract-001",
              contractNumber: "CTR-202609-TEST",
              ...params,
              status: "DRAFT",
            }),
          },
        };
        return await cb(tx);
      });

      const result = await createContract(params);
      expect(result.id).toBe("contract-001");
      expect(result.status).toBe("DRAFT");
    });
  });

  describe("proposeContract", () => {
    it("transitions a DRAFT contract to PROPOSED", async () => {
      prismaMock.contract.findUnique.mockResolvedValueOnce({
        id: "contract-001",
        status: "DRAFT",
        milestones: [],
      });

      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          contract: {
            update: vi.fn().mockResolvedValue({
              id: "contract-001",
              status: "PROPOSED",
            }),
          },
        };
        return await cb(tx);
      });

      const result = await proposeContract({
        contractId: "contract-001",
        actorId: "donor-123",
        actorRole: "DONOR",
      });

      expect(result.status).toBe("PROPOSED");
    });

    it("throws an error when trying to propose an already ACTIVE contract", async () => {
      prismaMock.contract.findUnique.mockResolvedValueOnce({
        id: "contract-001",
        status: "ACTIVE",
        milestones: [],
      });

      await expect(
        proposeContract({
          contractId: "contract-001",
          actorId: "donor-123",
          actorRole: "DONOR",
        })
      ).rejects.toThrow(/Cannot propose a contract that is currently in ACTIVE status/);
    });
  });

  describe("signContract (Dual E-Signature)", () => {
    it("records unilateral donor signature without activating yet", async () => {
      prismaMock.contract.findUnique.mockResolvedValueOnce({
        id: "contract-001",
        status: "PROPOSED",
        donorSignedAt: null,
        ngoSignedAt: null,
      });

      let updatedDataCaptured: any = null;
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          contractAuditLog: { create: vi.fn() },
          contract: {
            update: vi.fn().mockImplementation(({ data }: any) => {
              updatedDataCaptured = data;
              return { id: "contract-001", ...data };
            }),
          },
        };
        return await cb(tx);
      });

      await signContract({
        contractId: "contract-001",
        actorId: "donor-123",
        actorRole: "DONOR",
        signerName: "Sarah Jenkins",
        signerTitle: "CSR Head",
        signerIp: "192.168.1.1",
      });

      expect(updatedDataCaptured.donorSignedByName).toBe("Sarah Jenkins");
      expect(updatedDataCaptured.donorSignerTitle).toBe("CSR Head");
      expect(updatedDataCaptured.donorSignerIp).toBe("192.168.1.1");
      expect(updatedDataCaptured.status).toBeUndefined(); // Still PROPOSED, awaiting NGO signature
    });

    it("activates the contract to ACTIVE when counter-signed by NGO", async () => {
      prismaMock.contract.findUnique.mockResolvedValueOnce({
        id: "contract-001",
        status: "PROPOSED",
        donorSignedAt: new Date("2026-09-01"),
        ngoSignedAt: null,
      });

      let updatedDataCaptured: any = null;
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          contractAuditLog: { create: vi.fn() },
          contract: {
            update: vi.fn().mockImplementation(({ data }: any) => {
              updatedDataCaptured = data;
              return { id: "contract-001", ...data };
            }),
          },
        };
        return await cb(tx);
      });

      await signContract({
        contractId: "contract-001",
        actorId: "ngo-user-456",
        actorRole: "NGO",
        signerName: "Ramesh Sharma",
        signerTitle: "Managing Trustee",
        signerIp: "10.0.0.1",
      });

      expect(updatedDataCaptured.ngoSignedByName).toBe("Ramesh Sharma");
      expect(updatedDataCaptured.status).toBe("ACTIVE");
      expect(updatedDataCaptured.startDate).toBeDefined();
    });
  });

  describe("disburseMilestone", () => {
    it("disburses milestone tranche and auto-completes contract when all milestones disbursed", async () => {
      prismaMock.contract.findUnique.mockResolvedValueOnce({
        id: "contract-001",
        status: "ACTIVE",
        milestones: [
          { id: "m-1", title: "Milestone 1", allocatedAmount: 250000, status: "PENDING" },
        ],
      });

      let contractCompleted = false;
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          contractMilestone: {
            update: vi.fn(),
            count: vi.fn().mockResolvedValue(0), // 0 remaining undisbursed
          },
          contractAuditLog: { create: vi.fn() },
          contract: {
            update: vi.fn().mockImplementation(({ data }: any) => {
              if (data.status === "COMPLETED") contractCompleted = true;
            }),
            findUnique: vi.fn().mockResolvedValue({ id: "contract-001", status: "COMPLETED" }),
          },
        };
        return await cb(tx);
      });

      const result = await disburseMilestone({
        contractId: "contract-001",
        milestoneId: "m-1",
        actorId: "donor-123",
        actorRole: "DONOR",
      });

      expect(contractCompleted).toBe(true);
      expect(result.status).toBe("COMPLETED");
    });
  });

  describe("terminateContract", () => {
    it("marks contract as TERMINATED and writes termination reason into audit ledger", async () => {
      prismaMock.contract.findUnique.mockResolvedValueOnce({
        id: "contract-001",
        status: "ACTIVE",
      });

      let auditDetail: string = "";
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        const tx = {
          contractAuditLog: {
            create: vi.fn().mockImplementation(({ data }: any) => {
              auditDetail = data.detail;
            }),
          },
          contract: {
            update: vi.fn().mockResolvedValue({ id: "contract-001", status: "TERMINATED" }),
          },
        };
        return await cb(tx);
      });

      const result = await terminateContract({
        contractId: "contract-001",
        actorId: "donor-123",
        actorRole: "DONOR",
        reason: "Mutual agreement due to revised statutory timeline.",
      });

      expect(result.status).toBe("TERMINATED");
      expect(auditDetail).toContain("Mutual agreement due to revised statutory timeline.");
    });
  });
});
