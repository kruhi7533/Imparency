import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Week 6 — contract funding: NGO acceptance, donor-recorded payments, and
 * NGO reconciliation.
 *
 * Pins the four things CLAUDE.md treats as mandatory for this kind of change:
 *  - tenant isolation (another donor / another NGO gets 403, a payment id under
 *    another contract's URL gets 404),
 *  - the approval gate (no payment before the NGO accepts; FIELD_STAFF cannot
 *    accept or confirm money),
 *  - idempotency (a replayed submission or decision does not double-apply),
 *  - Decimal-safe amount rules (no overpaying the contract or a milestone,
 *    disputed money stops counting, pending money is not "funded").
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    contract: { findUnique: vi.fn(), updateMany: vi.fn() },
    contractMilestone: { findUnique: vi.fn() },
    contractPayment: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    contractAuditLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/finance-exceptions", () => ({ recordContractPaymentDispute: vi.fn().mockResolvedValue("opened") }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { recordContractPaymentDispute } from "@/lib/finance-exceptions";
import {
  checkAccept,
  checkDecision,
  checkRecordPayment,
  fundingSummary,
  sandboxReference,
} from "@/lib/contract-payments";
import { POST as ACCEPT } from "@/app/api/contracts/[id]/accept/route";
import { POST as RECORD, GET as LIST } from "@/app/api/contracts/[id]/payments/route";
import { PATCH as DECIDE } from "@/app/api/contracts/[id]/payments/[paymentId]/route";

const prismaMock = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const req = (body: unknown) =>
  new Request("http://test", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const D = (v: string | number) => new Prisma.Decimal(v);
const ACTIVE_ACCEPTED = { status: "ACTIVE" as const, ngoAcceptedAt: new Date(), totalGrantAmount: D("100000.00") };
const M1 = { id: "m1", contractId: "c1", allocatedAmount: D("40000.00") };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((cb: any) => cb(prismaMock));
});

// ─── Pure rules ──────────────────────────────────────────────────────────────

describe("checkRecordPayment", () => {
  const base = { contract: ACTIVE_ACCEPTED, milestone: null, contractId: "c1", payments: [], mode: "SANDBOX", reference: null };

  it("accepts a payment within the contract balance", () => {
    const r = checkRecordPayment({ ...base, amount: "25000.50" });
    expect(r.ok && r.amount.toFixed(2)).toBe("25000.50");
  });

  it("refuses before the NGO has accepted the funded project", () => {
    const r = checkRecordPayment({ ...base, contract: { ...ACTIVE_ACCEPTED, ngoAcceptedAt: null }, amount: 10 });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses on a contract that is not ACTIVE", () => {
    const r = checkRecordPayment({ ...base, contract: { ...ACTIVE_ACCEPTED, status: "PROPOSED" }, amount: 10 });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("requires a bank reference for a MANUAL payment", () => {
    expect(checkRecordPayment({ ...base, mode: "MANUAL", reference: "  ", amount: 10 })).toMatchObject({ ok: false, status: 400 });
    expect(checkRecordPayment({ ...base, mode: "MANUAL", reference: "UTR123", amount: 10 }).ok).toBe(true);
  });

  it.each([0, -5, "abc", "1.005", null, {}])("rejects bad amount %j", (amount) => {
    expect(checkRecordPayment({ ...base, amount }).ok).toBe(false);
  });

  it("rejects an unknown mode", () => {
    expect(checkRecordPayment({ ...base, mode: "CASH", amount: 10 })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses to overpay the contract, counting pending and reconciled but not disputed", () => {
    const payments = [
      { amount: D("60000"), status: "RECONCILED" as const, contractMilestoneId: null },
      { amount: D("30000"), status: "PENDING_CONFIRMATION" as const, contractMilestoneId: null },
      { amount: D("50000"), status: "DISPUTED" as const, contractMilestoneId: null },
    ];
    expect(checkRecordPayment({ ...base, payments, amount: "10000" }).ok).toBe(true);
    expect(checkRecordPayment({ ...base, payments, amount: "10000.01" })).toMatchObject({ ok: false, status: 422 });
  });

  it("refuses to overpay a milestone allocation", () => {
    const payments = [{ amount: D("30000"), status: "RECONCILED" as const, contractMilestoneId: "m1" }];
    expect(checkRecordPayment({ ...base, milestone: M1, payments, amount: 10000 }).ok).toBe(true);
    expect(checkRecordPayment({ ...base, milestone: M1, payments, amount: 10001 })).toMatchObject({ ok: false, status: 422 });
  });

  it("refuses a milestone from another contract", () => {
    const r = checkRecordPayment({ ...base, milestone: { ...M1, contractId: "c2" }, amount: 10 });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe("checkAccept / checkDecision", () => {
  it("accept: only ACTIVE, and a second accept is a no-op", () => {
    expect(checkAccept({ status: "PROPOSED", ngoAcceptedAt: null })).toMatchObject({ ok: false, status: 409 });
    expect(checkAccept({ status: "ACTIVE", ngoAcceptedAt: null })).toEqual({ ok: true, alreadyAccepted: false });
    expect(checkAccept({ status: "ACTIVE", ngoAcceptedAt: new Date() })).toEqual({ ok: true, alreadyAccepted: true });
  });

  it("decision: same decision repeated is a no-op, a reversal is a conflict", () => {
    expect(checkDecision("RECONCILED", "CONFIRM", null)).toMatchObject({ ok: true, noop: true });
    expect(checkDecision("RECONCILED", "DISPUTE", "never arrived")).toMatchObject({ ok: false, status: 409 });
    expect(checkDecision("DISPUTED", "CONFIRM", null)).toMatchObject({ ok: false, status: 409 });
  });

  it("decision: a dispute needs a reason", () => {
    expect(checkDecision("PENDING_CONFIRMATION", "DISPUTE", "")).toMatchObject({ ok: false, status: 400 });
    expect(checkDecision("PENDING_CONFIRMATION", "DISPUTE", "not received")).toMatchObject({ ok: true, target: "DISPUTED" });
  });
});

describe("fundingSummary", () => {
  it("counts only reconciled money as funded", () => {
    const s = fundingSummary({ totalGrantAmount: D("100000") }, [{ id: "m1", allocatedAmount: D("40000") }], [
      { amount: D("40000"), status: "RECONCILED", contractMilestoneId: "m1" },
      { amount: D("60000"), status: "PENDING_CONFIRMATION", contractMilestoneId: null },
    ]);
    expect(s.state).toBe("PARTIALLY_FUNDED");
    expect(s.reconciled).toBe("40000.00");
    expect(s.pending).toBe("60000.00");
    expect(s.milestones[0].state).toBe("FUNDED");
  });

  it("is UNFUNDED when the only payment is disputed", () => {
    const s = fundingSummary({ totalGrantAmount: D("100") }, [], [{ amount: D("100"), status: "DISPUTED", contractMilestoneId: null }]);
    expect(s.state).toBe("UNFUNDED");
    expect(s.recorded).toBe("0.00");
  });

  it("sandboxReference is stable per key", () => {
    expect(sandboxReference("abc-123-def-456")).toBe(sandboxReference("abc-123-def-456"));
    expect(sandboxReference("abc-123-def-456")).toMatch(/^SANDBOX-[A-Z0-9]+$/);
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────

const CONTRACT = { id: "c1", donorId: "donor-a", ngoId: "ngo-a", projectId: "p1", status: "ACTIVE", ngoAcceptedAt: null };

/** NGO user "u-owner" owns ngo-a; "u-other" owns ngo-b; team members via nGOTeamMember. */
function ngoDirectory(team: Record<string, string> = {}) {
  prismaMock.nGOProfile.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-owner" ? { id: "ngo-a" } : where.userId === "u-other" ? { id: "ngo-b" } : null),
  );
  prismaMock.nGOTeamMember.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(team[where.userId] && where.ngoId === "ngo-a" ? { role: team[where.userId] } : null),
  );
}

describe("POST /api/contracts/[id]/accept", () => {
  beforeEach(() => {
    ngoDirectory({ "u-field": "FIELD_STAFF", "u-admin": "ADMIN" });
    prismaMock.contract.findUnique.mockResolvedValue(CONTRACT);
    prismaMock.contract.updateMany.mockResolvedValue({ count: 1 });
  });

  it("owner accepts and an audit row is written", async () => {
    session("u-owner", "NGO");
    const res = await ACCEPT(req({}), { params: { id: "c1" } });
    expect(res.status).toBe(200);
    expect(prismaMock.contract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ngoAcceptedAt: null, status: "ACTIVE" }) }),
    );
    expect(prismaMock.contractAuditLog.create).toHaveBeenCalledTimes(1);
  });

  it("a team ADMIN can accept", async () => {
    session("u-admin", "NGO");
    expect((await ACCEPT(req({}), { params: { id: "c1" } })).status).toBe(200);
  });

  it("another NGO's owner gets 403", async () => {
    session("u-other", "NGO");
    expect((await ACCEPT(req({}), { params: { id: "c1" } })).status).toBe(403);
    expect(prismaMock.contract.updateMany).not.toHaveBeenCalled();
  });

  it("FIELD_STAFF of the right NGO gets 403", async () => {
    session("u-field", "NGO");
    expect((await ACCEPT(req({}), { params: { id: "c1" } })).status).toBe(403);
  });

  it("a donor cannot call it", async () => {
    session("donor-a", "DONOR");
    expect((await ACCEPT(req({}), { params: { id: "c1" } })).status).toBe(403);
  });

  it("accepting again is idempotent: 200, no second write", async () => {
    session("u-owner", "NGO");
    prismaMock.contract.findUnique.mockResolvedValue({ ...CONTRACT, ngoAcceptedAt: new Date() });
    expect((await ACCEPT(req({}), { params: { id: "c1" } })).status).toBe(200);
    expect(prismaMock.contract.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.contractAuditLog.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/contracts/[id]/payments", () => {
  const body = { amount: "5000", mode: "SANDBOX", idempotencyKey: "key-12345678" };

  beforeEach(() => {
    prismaMock.contract.findUnique.mockImplementation(({ select }: any) =>
      Promise.resolve(
        select?.payments
          ? { status: "ACTIVE", ngoAcceptedAt: new Date(), totalGrantAmount: D("100000"), payments: [] }
          : CONTRACT,
      ),
    );
    prismaMock.contractPayment.findUnique.mockResolvedValue(null);
    prismaMock.contractPayment.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "pay-1", ...data }));
  });

  it("the contract's donor records a sandbox payment", async () => {
    session("donor-a", "DONOR");
    const res = await RECORD(req(body), { params: { id: "c1" } });
    expect(res.status).toBe(201);
    const { data } = prismaMock.contractPayment.create.mock.calls[0][0];
    expect(data.reference).toMatch(/^SANDBOX-/);
    expect(data.amount.toFixed(2)).toBe("5000.00");
    expect(prismaMock.$queryRaw).toHaveBeenCalled(); // row lock taken
  });

  it("another donor gets 403 and nothing is written", async () => {
    session("donor-b", "DONOR");
    expect((await RECORD(req(body), { params: { id: "c1" } })).status).toBe(403);
    expect(prismaMock.contractPayment.create).not.toHaveBeenCalled();
  });

  it("an NGO cannot record a payment", async () => {
    session("u-owner", "NGO");
    expect((await RECORD(req(body), { params: { id: "c1" } })).status).toBe(403);
  });

  it("replaying the same idempotencyKey returns the first payment, not a second one", async () => {
    session("donor-a", "DONOR");
    prismaMock.contractPayment.findUnique.mockResolvedValue({ id: "pay-1", contractId: "c1" });
    const res = await RECORD(req(body), { params: { id: "c1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(prismaMock.contractPayment.create).not.toHaveBeenCalled();
  });

  it("a key already used on another contract is a 409, never that payment", async () => {
    session("donor-a", "DONOR");
    prismaMock.contractPayment.findUnique.mockResolvedValue({ id: "pay-x", contractId: "c-other" });
    expect((await RECORD(req(body), { params: { id: "c1" } })).status).toBe(409);
  });

  it("a concurrent duplicate that hits the unique index replays", async () => {
    session("donor-a", "DONOR");
    prismaMock.contractPayment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "pay-1", contractId: "c1" });
    prismaMock.contractPayment.create.mockRejectedValue({ code: "P2002" });
    const res = await RECORD(req(body), { params: { id: "c1" } });
    expect(res.status).toBe(200);
  });

  it("refuses before the NGO accepts", async () => {
    session("donor-a", "DONOR");
    prismaMock.contract.findUnique.mockImplementation(({ select }: any) =>
      Promise.resolve(select?.payments ? { status: "ACTIVE", ngoAcceptedAt: null, totalGrantAmount: D("100000"), payments: [] } : CONTRACT),
    );
    expect((await RECORD(req(body), { params: { id: "c1" } })).status).toBe(409);
    expect(prismaMock.contractPayment.create).not.toHaveBeenCalled();
  });
});

describe("GET /api/contracts/[id]/payments", () => {
  it("a stranger donor gets 403", async () => {
    session("donor-b", "DONOR");
    prismaMock.contract.findUnique.mockResolvedValue({ ...CONTRACT, totalGrantAmount: D("1"), milestones: [], payments: [] });
    expect((await LIST(req({}), { params: { id: "c1" } })).status).toBe(403);
  });
});

describe("PATCH /api/contracts/[id]/payments/[paymentId]", () => {
  const PAYMENT = { id: "pay-1", contractId: "c1", amount: D("5000"), status: "PENDING_CONFIRMATION", contract: CONTRACT };
  const patch = (body: unknown, id = "c1") =>
    DECIDE(new Request("http://test", { method: "PATCH", body: JSON.stringify(body) }), { params: { id, paymentId: "pay-1" } });

  beforeEach(() => {
    ngoDirectory({ "u-finance": "FINANCE", "u-field": "FIELD_STAFF" });
    prismaMock.contractPayment.findUnique.mockResolvedValue(PAYMENT);
    prismaMock.contractPayment.updateMany.mockResolvedValue({ count: 1 });
  });

  it("NGO finance confirms receipt → RECONCILED", async () => {
    session("u-finance", "NGO");
    const res = await patch({ decision: "CONFIRM" });
    expect(res.status).toBe(200);
    expect(prismaMock.contractPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay-1", status: "PENDING_CONFIRMATION" },
        data: expect.objectContaining({ status: "RECONCILED" }),
      }),
    );
    expect(recordContractPaymentDispute).not.toHaveBeenCalled();
  });

  it("a dispute raises a finance exception with ids only", async () => {
    session("u-owner", "NGO");
    expect((await patch({ decision: "DISPUTE", note: "Not in our account" })).status).toBe(200);
    expect(recordContractPaymentDispute).toHaveBeenCalledWith({
      paymentId: "pay-1",
      contractId: "c1",
      projectId: "p1",
      amount: PAYMENT.amount,
    });
  });

  it("another NGO gets 403", async () => {
    session("u-other", "NGO");
    expect((await patch({ decision: "CONFIRM" })).status).toBe(403);
    expect(prismaMock.contractPayment.updateMany).not.toHaveBeenCalled();
  });

  it("FIELD_STAFF cannot confirm money", async () => {
    session("u-field", "NGO");
    expect((await patch({ decision: "CONFIRM" })).status).toBe(403);
  });

  it("the donor cannot confirm their own payment", async () => {
    session("donor-a", "DONOR");
    expect((await patch({ decision: "CONFIRM" })).status).toBe(403);
  });

  it("a payment id under another contract's URL is 404", async () => {
    session("u-owner", "NGO");
    expect((await patch({ decision: "CONFIRM" }, "c-other")).status).toBe(404);
  });

  it("confirming an already reconciled payment is a no-op", async () => {
    session("u-owner", "NGO");
    prismaMock.contractPayment.findUnique.mockResolvedValue({ ...PAYMENT, status: "RECONCILED" });
    expect((await patch({ decision: "CONFIRM" })).status).toBe(200);
    expect(prismaMock.contractPayment.updateMany).not.toHaveBeenCalled();
  });

  it("losing a concurrent decision is a 409", async () => {
    session("u-owner", "NGO");
    prismaMock.contractPayment.updateMany.mockResolvedValue({ count: 0 });
    expect((await patch({ decision: "CONFIRM" })).status).toBe(409);
    expect(prismaMock.contractAuditLog.create).not.toHaveBeenCalled();
  });
});
