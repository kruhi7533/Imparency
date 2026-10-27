import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * "Project becomes FUNDED" (roadmap row 10): every committed contract rupee
 * reconciled. Approval gate: only RECONCILED money counts. Idempotency: the
 * event is stamped — and the parties notified — exactly once.
 */

const db = vi.hoisted(() => ({
  // findUnique/updateMany/$queryRaw: milestone + contract funding recalculation
  // (lib/contract-funding.ts) runs in the same transaction as a confirmation.
  contract: {
    findMany: vi.fn(),
    findUnique: vi.fn(async () => ({ id: "c-1", projectId: "p-1", totalGrantAmount: "1000000000", fundedAt: null, milestones: [], payments: [], paymentAllocations: [] })),
    updateMany: vi.fn(),
  },
  contractPaymentAllocation: { createMany: vi.fn() },
  contractMilestone: { update: vi.fn(), updateMany: vi.fn() },
  $queryRaw: vi.fn(),
  project: { updateMany: vi.fn(), findUnique: vi.fn() },
  contractPayment: { findUnique: vi.fn(), updateMany: vi.fn() },
  contractAuditLog: { create: vi.fn() },
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
  notification: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/finance-exceptions", () => ({ recordContractPaymentDispute: vi.fn(async () => "opened") }));

import { getServerSession } from "next-auth/next";
import { projectFunding, stampProjectFundedIfComplete } from "@/lib/project-funding";
import { PATCH as decide } from "@/app/api/contracts/[id]/payments/[paymentId]/route";

const contract = (status: string, total: number, payments: Array<[number, string]>) => ({
  status,
  totalGrantAmount: total,
  payments: payments.map(([amount, s]) => ({ amount, status: s })),
});

describe("projectFunding (pure)", () => {
  it("is FUNDED only when reconciled money covers every signed contract", () => {
    expect(projectFunding([contract("ACTIVE", 100000, [[60000, "RECONCILED"], [40000, "RECONCILED"]])])).toMatchObject({
      committed: "100000.00",
      reconciled: "100000.00",
      state: "FUNDED",
      funded: true,
    });
  });

  it("a donor-recorded payment the NGO has not confirmed, or a disputed one, is not funding", () => {
    const f = projectFunding([contract("ACTIVE", 100000, [[60000, "RECONCILED"], [40000, "PENDING_CONFIRMATION"]])]);
    expect(f).toMatchObject({ state: "PARTIALLY_FUNDED", funded: false, reconciled: "60000.00" });
    expect(projectFunding([contract("ACTIVE", 100000, [[100000, "DISPUTED"]])]).funded).toBe(false);
  });

  it("counts only signed (ACTIVE/COMPLETED) contracts — a draft or proposal is not a commitment", () => {
    const f = projectFunding([
      contract("COMPLETED", 50000, [[50000, "RECONCILED"]]),
      contract("PROPOSED", 900000, []),
      contract("TERMINATED", 300000, []),
    ]);
    expect(f).toMatchObject({ committed: "50000.00", funded: true });
  });

  it("several contracts: all must be covered", () => {
    const f = projectFunding([contract("ACTIVE", 50000, [[50000, "RECONCILED"]]), contract("ACTIVE", 50000, [])]);
    expect(f).toMatchObject({ committed: "100000.00", state: "PARTIALLY_FUNDED", funded: false });
  });

  it("no signed contract is UNFUNDED, never 'funded'; more than committed is OVERFUNDED and still funded", () => {
    expect(projectFunding([])).toMatchObject({ committed: "0.00", state: "UNFUNDED", funded: false });
    expect(projectFunding([contract("ACTIVE", 100, [[150, "RECONCILED"]])])).toMatchObject({ state: "OVERFUNDED", funded: true });
  });
});

describe("stampProjectFundedIfComplete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stamps fundedAt with a compare-and-swap on fundedAt: null", async () => {
    db.contract.findMany.mockResolvedValue([contract("ACTIVE", 100, [[100, "RECONCILED"]])]);
    db.project.updateMany.mockResolvedValue({ count: 1 });
    const now = new Date("2026-10-21");
    expect(await stampProjectFundedIfComplete(db as any, "p-1", now)).toBe(true);
    expect(db.project.updateMany).toHaveBeenCalledWith({ where: { id: "p-1", fundedAt: null }, data: { fundedAt: now } });
  });

  it("already stamped (a concurrent or repeated confirmation) -> false, so nobody is notified twice", async () => {
    db.contract.findMany.mockResolvedValue([contract("ACTIVE", 100, [[100, "RECONCILED"]])]);
    db.project.updateMany.mockResolvedValue({ count: 0 });
    expect(await stampProjectFundedIfComplete(db as any, "p-1")).toBe(false);
  });

  it("not fully funded -> no write at all", async () => {
    db.contract.findMany.mockResolvedValue([contract("ACTIVE", 100, [[40, "RECONCILED"]])]);
    expect(await stampProjectFundedIfComplete(db as any, "p-1")).toBe(false);
    expect(db.project.updateMany).not.toHaveBeenCalled();
  });
});

describe("confirming the last payment makes the project FUNDED", () => {
  const ctx = { params: { id: "c-1", paymentId: "pay-1" } };
  const req = (body: unknown) => new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });

  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
    (getServerSession as any).mockResolvedValue({ user: { id: "ngo-user-1", role: "NGO" } });
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-1" });
    db.contractPayment.findUnique.mockResolvedValue({
      id: "pay-1",
      contractId: "c-1",
      amount: { toFixed: () => "40000.00" },
      status: "PENDING_CONFIRMATION",
      contract: { id: "c-1", donorId: "donor-1", ngoId: "ngo-1", projectId: "p-1" },
    });
    db.contractPayment.updateMany.mockResolvedValue({ count: 1 });
    db.project.findUnique.mockResolvedValue({ title: "Digital classrooms", ngo: { userId: "ngo-user-1" }, contracts: [{ donorId: "donor-1" }] });
  });

  it("stamps fundedAt and tells the NGO and the donor once", async () => {
    db.contract.findMany.mockResolvedValue([contract("ACTIVE", 100000, [[60000, "RECONCILED"], [40000, "RECONCILED"]])]);
    db.project.updateMany.mockResolvedValue({ count: 1 });
    expect((await decide(req({ decision: "CONFIRM" }), ctx)).status).toBe(200);
    expect(db.project.updateMany).toHaveBeenCalledWith({ where: { id: "p-1", fundedAt: null }, data: { fundedAt: expect.any(Date) } });
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const recipients = db.notification.createMany.mock.calls[0][0].data.map((n: any) => n.userId).sort();
    expect(recipients).toEqual(["donor-1", "ngo-user-1"]);
  });

  it("a partial payment does not fund the project and notifies nobody", async () => {
    db.contract.findMany.mockResolvedValue([contract("ACTIVE", 100000, [[40000, "RECONCILED"]])]);
    await decide(req({ decision: "CONFIRM" }), ctx);
    expect(db.project.updateMany).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("a dispute never funds the project", async () => {
    await decide(req({ decision: "DISPUTE", note: "No credit on our statement." }), ctx);
    expect(db.contract.findMany).not.toHaveBeenCalled();
    expect(db.project.updateMany).not.toHaveBeenCalled();
  });

  it("already funded earlier: no second notification", async () => {
    db.contract.findMany.mockResolvedValue([contract("ACTIVE", 100000, [[100000, "RECONCILED"]])]);
    db.project.updateMany.mockResolvedValue({ count: 0 });
    await decide(req({ decision: "CONFIRM" }), ctx);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });
});
