import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn(), updateMany: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  contract: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  default: { $transaction: vi.fn(async (fn: any) => fn(tx)) },
}));

import { createContract } from "@/lib/contract-service";

const selected = (over: Record<string, unknown> = {}) => ({
  id: "req-1",
  sponsorId: "donor-1",
  status: "SELECTED",
  version: 5,
  selectedProjectId: "proj-1",
  selectedNgoId: "ngo-1",
  extractedFields: {},
  ...over,
});

const params = (over: Record<string, unknown> = {}) => ({
  donorId: "donor-1",
  ngoId: "ngo-1",
  projectId: "proj-1",
  requirementId: "req-1",
  title: "CSR Grant Agreement — Education, Assam",
  totalGrantAmount: 8000000,
  termsAndConditions: "Terms",
  milestones: [{ title: "Labs", description: "", allocatedAmount: 8000000 }],
  actorId: "donor-1",
  actorRole: "DONOR" as const,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  tx.contract.create.mockResolvedValue({ id: "contract-1", milestones: [], auditLogs: [] });
  tx.sponsorRequirement.updateMany.mockResolvedValue({ count: 1 });
  tx.requirementAuditLog.create.mockResolvedValue({});
});

describe("contract ↔ CSR requirement link", () => {
  it("links the selected NGO project and marks the requirement CONTRACTED in the same transaction", async () => {
    tx.sponsorRequirement.findUnique.mockResolvedValue(selected());
    const contract = await createContract(params());

    expect(contract.id).toBe("contract-1");
    expect(tx.contract.create.mock.calls[0][0].data).toMatchObject({ requirementId: "req-1", projectId: "proj-1", ngoId: "ngo-1", donorId: "donor-1", status: "DRAFT" });
    expect(tx.sponsorRequirement.updateMany).toHaveBeenCalledWith({
      where: { id: "req-1", version: 5, status: "SELECTED" },
      data: { status: "CONTRACTED" },
    });
    expect(tx.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CONTRACT_INITIATED", fromStatus: "SELECTED", toStatus: "CONTRACTED" }),
    });
  });

  it("refuses another donor's requirement", async () => {
    tx.sponsorRequirement.findUnique.mockResolvedValue(selected({ sponsorId: "donor-2" }));
    await expect(createContract(params())).rejects.toThrow("belongs to a different donor");
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("refuses a project other than the one selected for the requirement", async () => {
    tx.sponsorRequirement.findUnique.mockResolvedValue(selected());
    await expect(createContract(params({ projectId: "proj-2" }))).rejects.toThrow("selected NGO project");
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it("refuses a requirement that has not been awarded yet", async () => {
    tx.sponsorRequirement.findUnique.mockResolvedValue(selected({ status: "VALIDATED" }));
    await expect(createContract(params())).rejects.toThrow("selected NGO project");
  });

  it("leaves independent contracts (no requirement) unchanged", async () => {
    await createContract(params({ requirementId: null }));
    expect(tx.sponsorRequirement.findUnique).not.toHaveBeenCalled();
    expect(tx.sponsorRequirement.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.create.mock.calls[0][0].data.requirementId).toBeNull();
  });
});
