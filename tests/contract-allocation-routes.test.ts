import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * ADM-011 / NEG-006: admin approval of payment → milestone allocations on the
 * requirement → contract flow, plus UTR capture on payment recording (D5).
 * Admin-only, audited, CAS + row lock, idempotent replay, 422 on
 * over-allocation.
 */

const db = vi.hoisted(() => {
  const m: any = {
    contractPaymentAllocation: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn(), createMany: vi.fn() },
    contractPayment: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    contractMilestone: { findUnique: vi.fn(), findMany: vi.fn() },
    contract: { findUnique: vi.fn() },
    allocation: { findMany: vi.fn() },
    contractAuditLog: { create: vi.fn() },
    donorTeamMember: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return m;
});
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));
vi.mock("@/lib/contract-funding", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    recalcContractFunding: vi.fn(async () => ({ newlyFundedMilestones: [], contractNewlyFunded: false, projectNewlyFunded: false })),
    notifyAfterRecalc: vi.fn(),
  };
});

import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { recalcContractFunding } from "@/lib/contract-funding";
import { GET as LIST, POST as MANUAL } from "@/app/api/admin/contract-allocations/route";
import { PATCH as DECIDE } from "@/app/api/admin/contract-allocations/[id]/route";
import { GET as LIST_ALL } from "@/app/api/admin/allocations/route";
import { POST as RECORD } from "@/app/api/contracts/[id]/payments/route";

const D = (v: string | number) => new Prisma.Decimal(v);
const as = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const json = (url: string, method: string, body?: unknown) =>
  new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  as("admin-1", "ADMIN");
});

describe("GET /api/admin/contract-allocations and /api/admin/allocations", () => {
  it("non-admins get 403", async () => {
    as("donor-1", "DONOR");
    expect((await LIST(json("http://t/api/admin/contract-allocations", "GET"))).status).toBe(403);
    expect((await LIST_ALL(json("http://t/api/admin/allocations", "GET"))).status).toBe(403);
  });

  it("lists lines, filtered by status", async () => {
    db.contractPaymentAllocation.findMany.mockResolvedValue([
      {
        id: "a1",
        amount: D("400000"),
        rule: "AUTO_MILESTONE_ORDER",
        status: "PENDING_APPROVAL",
        contractMilestone: { id: "m1", title: "Baseline", allocatedAmount: D("400000"), fundingStatus: "FUNDED", orderIndex: 0 },
        payment: { id: "p1", amount: D("1000000"), status: "RECONCILED", mode: "SANDBOX", reference: "TESTUTR20260001", utr: "TESTUTR20260001" },
        contract: { id: "c1", contractNumber: "CTR-1", requirementId: "req-1" },
      },
    ]);
    const res = await LIST(json("http://t/api/admin/contract-allocations?status=PENDING_APPROVAL", "GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allocations[0]).toMatchObject({ id: "a1", amount: "400000.00", payment: { utr: "TESTUTR20260001" } });
    expect(db.contractPaymentAllocation.findMany.mock.calls[0][0].where).toEqual({ status: "PENDING_APPROVAL" });
    expect((await LIST(json("http://t/api/admin/contract-allocations?status=NOPE", "GET"))).status).toBe(400);
  });

  it("the tester's GET /api/admin/allocations no longer 405s and includes contract lines", async () => {
    db.allocation.findMany.mockResolvedValue([]);
    db.contractPaymentAllocation.findMany.mockResolvedValue([{ id: "a1", amount: D("1"), contract: { contractNumber: "CTR-1", requirementId: "req-1" } }]);
    const res = await LIST_ALL(json("http://t/api/admin/allocations?status=PENDING", "GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contractAllocations[0].id).toBe("a1");
    expect(db.contractPaymentAllocation.findMany.mock.calls[0][0].where).toEqual({ status: "PENDING_APPROVAL" });
  });
});

describe("PATCH /api/admin/contract-allocations/[id]", () => {
  const LINE = {
    id: "a1",
    status: "PENDING_APPROVAL",
    amount: D("400000"),
    paymentId: "p1",
    contractMilestoneId: "m1",
    payment: { status: "RECONCILED" },
    contractMilestone: { allocatedAmount: D("400000") },
  };
  const decide = (body: unknown) => DECIDE(json("http://t", "PATCH", body), { params: { id: "a1" } });

  beforeEach(() => {
    db.contractPaymentAllocation.findUnique.mockImplementation(async ({ select }: any) =>
      select?.payment ? LINE : { id: "a1", contractId: "c1" },
    );
    db.contractPaymentAllocation.findMany.mockResolvedValue([{ paymentId: "p1", contractMilestoneId: "m1", amount: D("400000"), status: "PENDING_APPROVAL" }]);
    db.contractPayment.findMany.mockResolvedValue([{ id: "p1", amount: D("1000000"), status: "RECONCILED" }]);
    db.contractPaymentAllocation.updateMany.mockResolvedValue({ count: 1 });
  });

  it("refuses a non-admin", async () => {
    as("ngo-1", "NGO");
    expect((await decide({ action: "APPROVE" })).status).toBe(403);
    expect(db.contractPaymentAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("approves reconciled money: row lock, compare-and-swap, contract audit row, admin log", async () => {
    const res = await decide({ action: "APPROVE" });
    expect(res.status).toBe(200);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.contractPaymentAllocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", status: "PENDING_APPROVAL" }, data: expect.objectContaining({ status: "APPROVED" }) }),
    );
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "ALLOCATION_APPROVED", entityId: "a1" }));
    const meta = (logAdminAction as any).mock.calls[0][0];
    expect(JSON.stringify(meta)).not.toMatch(/@/);
  });

  it("will not approve money that is only pending (approval gate)", async () => {
    db.contractPaymentAllocation.findUnique.mockImplementation(async ({ select }: any) =>
      select?.payment ? { ...LINE, payment: { status: "PENDING_CONFIRMATION" } } : { id: "a1", contractId: "c1" },
    );
    expect((await decide({ action: "APPROVE" })).status).toBe(409);
    expect(db.contractPaymentAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("over-allocation on the milestone is refused with 422", async () => {
    db.contractPaymentAllocation.findMany.mockResolvedValue([
      { paymentId: "p1", contractMilestoneId: "m1", amount: D("400000"), status: "PENDING_APPROVAL" },
      { paymentId: "p2", contractMilestoneId: "m1", amount: D("1"), status: "APPROVED" },
    ]);
    db.contractPayment.findMany.mockResolvedValue([
      { id: "p1", amount: D("1000000"), status: "RECONCILED" },
      { id: "p2", amount: D("1"), status: "RECONCILED" },
    ]);
    expect((await decide({ action: "APPROVE" })).status).toBe(422);
    expect(db.contractPaymentAllocation.updateMany).not.toHaveBeenCalled();
  });

  it("replaying the same decision is an idempotent 200 with no second write", async () => {
    db.contractPaymentAllocation.findUnique.mockImplementation(async ({ select }: any) =>
      select?.payment ? { ...LINE, status: "APPROVED" } : { id: "a1", contractId: "c1" },
    );
    const res = await decide({ action: "APPROVE" });
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(db.contractPaymentAllocation.updateMany).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it("a different decision on a decided line is 409; losing the CAS race is 409", async () => {
    db.contractPaymentAllocation.findUnique.mockImplementation(async ({ select }: any) =>
      select?.payment ? { ...LINE, status: "REJECTED" } : { id: "a1", contractId: "c1" },
    );
    expect((await decide({ action: "APPROVE" })).status).toBe(409);

    db.contractPaymentAllocation.findUnique.mockImplementation(async ({ select }: any) => (select?.payment ? LINE : { id: "a1", contractId: "c1" }));
    db.contractPaymentAllocation.updateMany.mockResolvedValue({ count: 0 });
    expect((await decide({ action: "APPROVE" })).status).toBe(409);
    expect(db.contractAuditLog.create).not.toHaveBeenCalled();
  });

  it("a rejection needs a note, then recalculates milestone funding", async () => {
    expect((await decide({ action: "REJECT" })).status).toBe(400);
    expect((await decide({ action: "REJECT", note: "Belongs to milestone 3" })).status).toBe(200);
    expect(recalcContractFunding).toHaveBeenCalledWith(db, "c1");
  });

  it("an unknown action (incl. prototype keys) is 400", async () => {
    expect((await decide({ action: "toString" })).status).toBe(400);
  });
});

describe("POST /api/admin/contract-allocations (manual re-allocation)", () => {
  beforeEach(() => {
    db.contractPayment.findUnique.mockImplementation(async ({ select }: any) =>
      select?.amount ? { id: "p1", amount: D("1000000"), status: "RECONCILED", contractId: "c1" } : { id: "p1", contractId: "c1" },
    );
    db.contractMilestone.findUnique.mockResolvedValue({ id: "m3", contractId: "c1", allocatedAmount: D("800000") });
    db.contractPaymentAllocation.findMany.mockResolvedValue([
      { id: "a1", paymentId: "p1", contractMilestoneId: "m1", amount: D("400000"), status: "APPROVED" },
      { id: "a2", paymentId: "p1", contractMilestoneId: "m2", amount: D("600000"), status: "REJECTED" },
    ]);
    db.contractPayment.findMany.mockResolvedValue([{ id: "p1", amount: D("1000000"), status: "RECONCILED" }]);
    db.contractPaymentAllocation.create.mockImplementation(async ({ data }: any) => ({ id: "a3", ...data, status: "PENDING_APPROVAL" }));
  });
  const post = (body: unknown) => MANUAL(json("http://t", "POST", body));

  it("allocates what a rejection freed, under the row lock, audited", async () => {
    const res = await post({ paymentId: "p1", contractMilestoneId: "m3", amount: "600000" });
    expect(res.status).toBe(201);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.contractPaymentAllocation.create.mock.calls[0][0].data).toMatchObject({ rule: "ADMIN_MANUAL", contractMilestoneId: "m3" });
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "ALLOCATION_PROPOSED", entityType: "ALLOCATION" }));
  });

  it("over-allocating the payment is 422 and writes nothing", async () => {
    expect((await post({ paymentId: "p1", contractMilestoneId: "m3", amount: "600000.01" })).status).toBe(422);
    expect(db.contractPaymentAllocation.create).not.toHaveBeenCalled();
  });

  it("a second live line on the same milestone is 409", async () => {
    db.contractMilestone.findUnique.mockResolvedValue({ id: "m1", contractId: "c1", allocatedAmount: D("2000000") });
    expect((await post({ paymentId: "p1", contractMilestoneId: "m1", amount: "1" })).status).toBe(409);
  });
});

// ─── Payment recording: allocation + UTR (D5) ────────────────────────────────

describe("POST /api/contracts/[id]/payments — milestone allocation and UTR", () => {
  const CONTRACT = { id: "c1", donorId: "donor-a", ngoId: "ngo-a" };
  const MILESTONES = [
    { id: "m1", allocatedAmount: D("400000"), orderIndex: 0, createdAt: new Date(1) },
    { id: "m2", allocatedAmount: D("800000"), orderIndex: 1, createdAt: new Date(1) },
  ];
  const record = (body: any) =>
    RECORD(json("http://t", "POST", { idempotencyKey: "key-12345678", amount: "1000000", mode: "SANDBOX", ...body }), { params: { id: "c1" } });

  beforeEach(() => {
    as("donor-a", "DONOR");
    db.donorTeamMember.findUnique.mockResolvedValue(null);
    db.contract.findUnique.mockImplementation(async ({ select }: any) =>
      select?.payments ? { status: "ACTIVE", ngoAcceptedAt: new Date(), totalGrantAmount: D("2250000"), payments: [] } : CONTRACT,
    );
    db.contractPayment.findUnique.mockResolvedValue(null);
    db.contractPayment.findFirst.mockResolvedValue(null);
    db.contractPayment.findMany.mockResolvedValue([]);
    db.contractMilestone.findMany.mockResolvedValue(MILESTONES);
    db.contractPaymentAllocation.findMany.mockResolvedValue([]);
    db.contractPayment.create.mockImplementation(async ({ data }: any) => ({ id: "pay-1", ...data }));
  });

  it("sandbox keeps the donor's UTR, normalised (trim, uppercase, no spaces)", async () => {
    const res = await record({ utr: "  testutr 2026 0001 " });
    expect(res.status).toBe(201);
    const { data } = db.contractPayment.create.mock.calls[0][0];
    expect(data.utr).toBe("TESTUTR20260001");
    expect(data.reference).toBe("TESTUTR20260001");
    expect(data.payerAccountId).toBe("donor-a");
  });

  it("the legacy `reference` field is the same UTR", async () => {
    await record({ reference: "TESTUTR20260002" });
    expect(db.contractPayment.create.mock.calls[0][0].data.utr).toBe("TESTUTR20260002");
  });

  it("a generated SANDBOX id only when no UTR was given", async () => {
    await record({});
    const { data } = db.contractPayment.create.mock.calls[0][0];
    expect(data.utr).toBeNull();
    expect(data.reference).toMatch(/^SANDBOX-/);
  });

  it("a malformed UTR is 400; manual mode without one is 400", async () => {
    expect((await record({ utr: "paid!" })).status).toBe(400);
    expect((await record({ mode: "MANUAL" })).status).toBe(400);
    expect(db.contractPayment.create).not.toHaveBeenCalled();
  });

  it("a UTR this donor account already used (any contract) is 409", async () => {
    db.contractPayment.findFirst.mockResolvedValue({ id: "old", contractId: "c-other" });
    expect((await record({ utr: "TESTUTR20260001" })).status).toBe(409);
    expect(db.contractPayment.findFirst.mock.calls[0][0].where).toEqual({ payerAccountId: "donor-a", utr: "TESTUTR20260001" });
    expect(db.contractPayment.create).not.toHaveBeenCalled();
  });

  it("a concurrent duplicate UTR that hits the unique index is 409", async () => {
    db.contractPayment.create.mockRejectedValue({ code: "P2002" });
    expect((await record({ utr: "TESTUTR20260001" })).status).toBe(409);
  });

  it("no milestone chosen → split in milestone order, in the same transaction; funding does not move", async () => {
    const res = await record({ amount: "1000000" });
    expect(res.status).toBe(201);
    const { data } = db.contractPaymentAllocation.createMany.mock.calls[0][0];
    expect(data.map((d: any) => [d.contractMilestoneId, d.amount.toFixed(2), d.rule])).toEqual([
      ["m1", "400000.00", "AUTO_MILESTONE_ORDER"],
      ["m2", "600000.00", "AUTO_MILESTONE_ORDER"],
    ]);
    expect(recalcContractFunding).not.toHaveBeenCalled(); // pending money is not funding
  });

  it("a chosen milestone gets one EXPLICIT line", async () => {
    db.contractMilestone.findUnique.mockResolvedValue({ id: "m2", contractId: "c1", allocatedAmount: D("800000"), title: "Build" });
    await record({ amount: "500000", contractMilestoneId: "m2" });
    const { data } = db.contractPaymentAllocation.createMany.mock.calls[0][0];
    expect(data).toEqual([expect.objectContaining({ contractMilestoneId: "m2", rule: "EXPLICIT" })]);
  });
});
