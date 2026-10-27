import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * NGO-015 — expense / utilisation recording per contract milestone.
 * Decimal money, receipt to private storage, ownership + team-role checks,
 * idempotent replay, allocation ceiling, donor read-only utilisation.
 */

vi.mock("@/lib/prisma", () => {
  const db: any = {
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    donorTeamMember: { findUnique: vi.fn() },
    contract: { findUnique: vi.fn() },
    contractMilestone: { findUnique: vi.fn(), findMany: vi.fn() },
    contractPayment: { findMany: vi.fn() },
    contractExpense: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    $queryRaw: vi.fn(),
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { default: db };
});
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  uploadPrivateFile: vi.fn(async () => "expense-receipts/abc.pdf"),
  deletePrivateFile: vi.fn(async () => {}),
  readPrivateFile: vi.fn(async () => Buffer.from("%PDF-1.4")),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { uploadPrivateFile, deletePrivateFile } from "@/lib/storage";
import { parseExpense, computeUtilisation, exceedsAllocation, sniffReceipt, percentOf } from "@/lib/contract-expenses";
import { POST as _RECORD } from "@/app/api/ngo/contracts/[id]/expenses/route";
import { GET as _UTILISATION } from "@/app/api/contract-utilisation/[id]/route";
import { GET as _RECEIPT } from "@/app/api/contract-utilisation/[id]/receipt/[expenseId]/route";

// Handlers are typed with the auth guard's nullable response; every path under test returns one.
const RECORD = _RECORD as (...a: any[]) => Promise<Response>;
const UTILISATION = _UTILISATION as (...a: any[]) => Promise<Response>;
const RECEIPT = _RECEIPT as (...a: any[]) => Promise<Response>;

const db = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });
const D = (v: string) => new Prisma.Decimal(v);

function form(fields: Record<string, string>, receipt?: Uint8Array) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  if (receipt) fd.append("receipt", new File([receipt as any], "r.pdf", { type: "application/pdf" }));
  return new Request("http://t", { method: "POST", body: fd });
}
const valid = { contractMilestoneId: "m-1", amount: "12500.50", category: "MATERIALS", description: "Sewing machines", spentOn: "2026-10-01", idempotencyKey: "exp-12345678" };

beforeEach(() => {
  vi.clearAllMocks();
  db.nGOProfile.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.userId === "u-a" ? { id: "ngo-a" } : where.userId === "u-b" ? { id: "ngo-b" } : null));
  db.nGOTeamMember.findFirst.mockImplementation(({ where }: any) =>
    Promise.resolve(where.userId === "u-field" ? { ngoId: "ngo-a", role: "FIELD_STAFF" } : where.userId === "u-fin" ? { ngoId: "ngo-a", role: "FINANCE" } : null),
  );
  db.donorTeamMember.findUnique.mockResolvedValue(null);
  db.contract.findUnique.mockResolvedValue({ id: "c-1", ngoId: "ngo-a", donorId: "donor-1", status: "ACTIVE" });
  db.contractMilestone.findUnique.mockImplementation(({ select }: any) =>
    Promise.resolve(select?.allocatedAmount ? { allocatedAmount: D("50000.00") } : { id: "m-1", contractId: "c-1" }),
  );
  db.contractExpense.findUnique.mockResolvedValue(null);
  db.contractExpense.aggregate.mockResolvedValue({ _sum: { amount: D("10000.00") } });
  db.contractExpense.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "e-1", ...data, createdAt: new Date() }));
});

describe("pure rules", () => {
  it("parses money as Decimal and refuses floats with >2dp, future dates and bad categories", () => {
    const p = parseExpense(valid, new Date("2026-10-27"));
    expect(p.ok && p.value.amount.toFixed(2)).toBe("12500.50");
    expect(parseExpense({ ...valid, amount: "1.005" })).toMatchObject({ ok: false });
    expect(parseExpense({ ...valid, amount: "0" })).toMatchObject({ ok: false });
    expect(parseExpense({ ...valid, category: "PARTY" })).toMatchObject({ ok: false });
    expect(parseExpense({ ...valid, spentOn: "2027-01-01" }, new Date("2026-10-27"))).toMatchObject({ ok: false });
  });
  it("sniffs receipts by magic bytes", () => {
    expect(sniffReceipt(new TextEncoder().encode("%PDF-1.7"))?.mime).toBe("application/pdf");
    expect(sniffReceipt(new TextEncoder().encode("<html>"))).toBeNull();
  });
  it("allocation ceiling is exact Decimal arithmetic", () => {
    expect(exceedsAllocation("100.00", "99.99", D("0.01"))).toBe(false);
    expect(exceedsAllocation("100.00", "99.99", D("0.02"))).toBe(true);
  });
  it("utilisation counts only RECONCILED payments as received; no base → null, never 0%", () => {
    const u = computeUtilisation(
      [{ id: "m-1", title: "Phase 1", allocatedAmount: "50000.00" }, { id: "m-2", title: "Phase 2", allocatedAmount: "50000.00" }],
      [
        { contractMilestoneId: "m-1", amount: "40000.00", status: "RECONCILED" },
        { contractMilestoneId: "m-1", amount: "10000.00", status: "PENDING_CONFIRMATION" },
        { contractMilestoneId: "m-2", amount: "5000.00", status: "DISPUTED" },
      ],
      [{ contractMilestoneId: "m-1", amount: "10000.00" }, { contractMilestoneId: "m-1", amount: "20000.00" }],
    );
    expect(u.milestones[0]).toMatchObject({ received: "40000.00", spent: "30000.00", utilisationOfReceived: 75, utilisationOfAllocated: 60 });
    expect(u.milestones[1].utilisationOfReceived).toBeNull();
    expect(u.totals).toMatchObject({ allocated: "100000.00", received: "40000.00", spent: "30000.00" });
    expect(percentOf(D("1"), D("3"))).toBe(33.3);
  });
});

describe("POST /api/ngo/contracts/[id]/expenses", () => {
  it("records an expense with a private receipt", async () => {
    session("u-fin", "NGO");
    const res = await RECORD(form(valid, new TextEncoder().encode("%PDF-1.4 receipt")), { params: { id: "c-1" } });
    expect(res.status).toBe(201);
    expect(uploadPrivateFile).toHaveBeenCalledWith(expect.any(Buffer), ".pdf", "expense-receipts");
    const data = db.contractExpense.create.mock.calls[0][0].data;
    expect(data.amount.toFixed(2)).toBe("12500.50");
    expect(data).toMatchObject({ contractId: "c-1", contractMilestoneId: "m-1", ngoId: "ngo-a", receiptKey: "expense-receipts/abc.pdf", receiptMime: "application/pdf" });
  });
  it("isolation: org B gets 403 on org A's contract", async () => {
    session("u-b", "NGO");
    expect((await RECORD(form(valid), { params: { id: "c-1" } })).status).toBe(403);
    expect(db.contractExpense.create).not.toHaveBeenCalled();
  });
  it("field staff cannot record spend", async () => {
    session("u-field", "NGO");
    expect((await RECORD(form(valid), { params: { id: "c-1" } })).status).toBe(403);
  });
  it("a milestone from another contract is refused", async () => {
    session("u-a", "NGO");
    db.contractMilestone.findUnique.mockResolvedValue({ id: "m-x", contractId: "c-other" });
    expect((await RECORD(form(valid), { params: { id: "c-1" } })).status).toBe(404);
  });
  it("is idempotent: a replay returns the stored row and uploads nothing", async () => {
    session("u-a", "NGO");
    db.contractExpense.findUnique.mockResolvedValue({ id: "e-1", contractId: "c-1", contractMilestoneId: "m-1", amount: D("12500.50"), category: "MATERIALS", description: "x", spentOn: new Date(), receiptKey: null, createdAt: new Date() });
    const res = await RECORD(form(valid, new TextEncoder().encode("%PDF")), { params: { id: "c-1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(uploadPrivateFile).not.toHaveBeenCalled();
    expect(db.contractExpense.create).not.toHaveBeenCalled();
  });
  it("refuses spend above the milestone allocation (422) and removes the uploaded receipt", async () => {
    session("u-a", "NGO");
    db.contractExpense.aggregate.mockResolvedValue({ _sum: { amount: D("45000.00") } });
    const res = await RECORD(form(valid, new TextEncoder().encode("%PDF")), { params: { id: "c-1" } });
    expect(res.status).toBe(422);
    expect(deletePrivateFile).toHaveBeenCalledWith("expense-receipts/abc.pdf");
    expect(db.$queryRaw).toHaveBeenCalled(); // row lock taken before the check
  });
  it("rejects a non-PDF/image receipt", async () => {
    session("u-a", "NGO");
    expect((await RECORD(form(valid, new TextEncoder().encode("<script>")), { params: { id: "c-1" } })).status).toBe(400);
  });
  it("only on an ACTIVE/COMPLETED contract", async () => {
    session("u-a", "NGO");
    db.contract.findUnique.mockResolvedValue({ id: "c-1", ngoId: "ngo-a", status: "PROPOSED" });
    expect((await RECORD(form(valid), { params: { id: "c-1" } })).status).toBe(409);
  });
});

describe("donor read-only utilisation", () => {
  beforeEach(() => {
    db.contractMilestone.findMany.mockResolvedValue([{ id: "m-1", title: "Phase 1", allocatedAmount: D("50000.00") }]);
    db.contractPayment.findMany.mockResolvedValue([{ contractMilestoneId: "m-1", amount: D("20000.00"), status: "RECONCILED" }]);
    db.contractExpense.findMany.mockResolvedValue([{ id: "e-1", contractMilestoneId: "m-1", amount: D("5000.00"), category: "TRAVEL", description: "Bus", spentOn: new Date(), receiptKey: "k" }]);
  });
  it("the funding donor sees per-milestone utilisation", async () => {
    session("donor-1", "DONOR");
    const res = await UTILISATION(new Request("http://t"), { params: { id: "c-1" } });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.party).toBe("DONOR");
    expect(j.milestones[0]).toMatchObject({ spent: "5000.00", utilisationOfReceived: 25 });
    expect(j.expenses[0].hasReceipt).toBe(true);
    expect(JSON.stringify(j)).not.toContain('"receiptKey"');
  });
  it("a stranger gets 404 for utilisation and receipts", async () => {
    session("donor-2", "DONOR");
    expect((await UTILISATION(new Request("http://t"), { params: { id: "c-1" } })).status).toBe(404);
    db.contractExpense.findUnique.mockResolvedValue({ id: "e-1", contractId: "c-1", receiptKey: "k", receiptMime: "application/pdf" });
    expect((await RECEIPT(new Request("http://t"), { params: { id: "c-1", expenseId: "e-1" } })).status).toBe(404);
  });
  it("the funding donor can open a receipt, served no-store", async () => {
    session("donor-1", "DONOR");
    db.contractExpense.findUnique.mockResolvedValue({ id: "e-1", contractId: "c-1", receiptKey: "k", receiptMime: "application/pdf" });
    const res = await RECEIPT(new Request("http://t"), { params: { id: "c-1", expenseId: "e-1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});
