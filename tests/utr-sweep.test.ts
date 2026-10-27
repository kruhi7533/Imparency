import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * ADM-009 / DON-010 / D5: UTR normalisation, the admin reconcile sweep that
 * matches imported bank-statement lines to contract payments by UTR, the
 * exception queue for what it cannot place, and the audited manual match.
 */

const db = vi.hoisted(() => ({
  bankStatementLine: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  contractPayment: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  contractAuditLog: { create: vi.fn() },
  financeException: { findMany: vi.fn(), updateMany: vi.fn() },
  contract: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/bank-statement", () => ({
  rematchNgoStatements: vi.fn(async () => ({ matched: [{ paymentId: "p1" }], amountMismatch: 0, ambiguous: 0, unmatched: 1 })),
}));
vi.mock("@/lib/finance-exceptions", () => ({
  recordException: vi.fn(async () => "opened"),
  autoResolveExceptions: vi.fn(async () => 1),
}));
vi.mock("@/lib/contract-funding", () => ({
  recalcContractFunding: vi.fn(async () => ({ newlyFundedMilestones: [], contractNewlyFunded: false, projectNewlyFunded: false })),
  notifyAfterRecalc: vi.fn(),
}));

import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { rematchNgoStatements } from "@/lib/bank-statement";
import { autoResolveExceptions, recordException } from "@/lib/finance-exceptions";
import { recalcContractFunding } from "@/lib/contract-funding";
import { normalizeUtr, parseUtr } from "@/lib/utr";
import { adminMatchBankLine, runUtrSweep } from "@/lib/utr-sweep";
import { POST as MATCH } from "@/app/api/admin/finance/bank-lines/[id]/match/route";

const D = (v: string | number) => new Prisma.Decimal(v);

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  (getServerSession as any).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
});

describe("UTR normalisation and format", () => {
  it("trims, uppercases and strips spaces", () => {
    expect(normalizeUtr("  testutr 2026\t0001 ")).toBe("TESTUTR20260001");
    expect(parseUtr(" hdfc n5 2026 1027 00001")).toEqual({ ok: true, utr: "HDFCN52026102700001" });
  });
  it("blank / absent is no UTR; junk and too-short are refused", () => {
    expect(parseUtr(undefined)).toEqual({ ok: true, utr: null });
    expect(parseUtr("   ")).toEqual({ ok: true, utr: null });
    expect(parseUtr("12345").ok).toBe(false);
    expect(parseUtr("UTR-1234-5678").ok).toBe(false);
    expect(parseUtr(12345678).ok).toBe(false);
    expect(parseUtr("A".repeat(31)).ok).toBe(false);
    expect(parseUtr("123456")).toEqual({ ok: true, utr: "123456" }); // cheque number
  });
});

describe("runUtrSweep — POST /api/admin/finance/reconcile", () => {
  beforeEach(() => {
    db.bankStatementLine.findMany.mockImplementation(async ({ distinct, where }: any) => {
      if (distinct) return [{ ngoId: "ngo-1" }, { ngoId: "ngo-2" }];
      if (where?.id) return [{ id: "line-matched" }];
      return [
        { id: "line-u", ngoId: "ngo-1", amount: D("500"), status: "UNMATCHED", valueDate: new Date("2026-10-20"), reference: "testutr 9", candidatePaymentIds: [] },
        { id: "line-resolved", ngoId: "ngo-2", amount: D("700"), status: "UNMATCHED", valueDate: new Date("2026-10-20"), reference: null, candidatePaymentIds: [] },
      ];
    });
    db.financeException.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "RESOLVED" ? [{ entityId: "line-resolved" }] : [{ entityId: "line-matched" }],
    );
    db.contract.findMany.mockResolvedValue([{ id: "c1" }]);
  });

  it("re-matches every NGO with open lines by UTR, as ADMIN", async () => {
    const r = await runUtrSweep("admin-1");
    expect(rematchNgoStatements).toHaveBeenCalledWith("ngo-1", "admin-1", undefined, "ADMIN");
    expect(rematchNgoStatements).toHaveBeenCalledWith("ngo-2", "admin-1", undefined, "ADMIN");
    expect(r.matched).toBe(2);
  });

  it("queues unmatched lines (ids + amounts only), but never re-raises one an admin resolved", async () => {
    const r = await runUtrSweep("admin-1");
    expect(recordException).toHaveBeenCalledTimes(1);
    const finding = (recordException as any).mock.calls[0][0];
    expect(finding).toMatchObject({ type: "UNMATCHED_BANK_LINE", entityType: "BANK_LINE", entityId: "line-u" });
    expect(finding.detail.utr).toBe("TESTUTR9");
    expect(finding.summary).not.toMatch(/@/);
    expect(r.queued).toBe(1);
  });

  it("closes the exception of a line matched since, and heals milestone funding on signed contracts", async () => {
    const r = await runUtrSweep("admin-1");
    expect(autoResolveExceptions).toHaveBeenCalledWith("UNMATCHED_BANK_LINE", ["line-matched"], expect.any(String));
    expect(recalcContractFunding).toHaveBeenCalledWith(db, "c1");
    expect(r.contractsRecalculated).toBe(1);
  });
});

describe("manual match — POST /api/admin/finance/bank-lines/[id]/match", () => {
  const LINE = { id: "line-1", ngoId: "ngo-1", direction: "CREDIT", status: "UNMATCHED", amount: D("1000000"), valueDate: new Date("2026-10-20"), matchedPaymentId: null };
  const PAYMENT = { id: "p1", amount: D("1000000"), status: "PENDING_CONFIRMATION", utr: "TESTUTR20260001", reference: "TESTUTR20260001", contractId: "c1", contract: { ngoId: "ngo-1" } };
  const post = (body: unknown) => MATCH(new Request("http://t", { method: "POST", body: JSON.stringify(body) }), { params: { id: "line-1" } });

  beforeEach(() => {
    db.bankStatementLine.findUnique.mockResolvedValue(LINE);
    db.contractPayment.findUnique.mockResolvedValue(PAYMENT);
    db.contractPayment.updateMany.mockResolvedValue({ count: 1 });
    db.bankStatementLine.updateMany.mockResolvedValue({ count: 1 });
    db.financeException.updateMany.mockResolvedValue({ count: 1 });
  });

  it("admin only, and a note is required", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "ngo-u", role: "NGO" } });
    expect((await post({ paymentId: "p1", note: "x" })).status).toBe(403);
    (getServerSession as any).mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    expect((await post({ paymentId: "p1" })).status).toBe(400);
  });

  it("reconciles the payment, marks the line, resolves the exception, recalculates funding, audits", async () => {
    const res = await post({ paymentId: "p1", note: "UTR typo on the statement" });
    expect(res.status).toBe(200);
    expect(db.contractPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "p1", status: "PENDING_CONFIRMATION" }), data: expect.objectContaining({ status: "RECONCILED", reconciledVia: "ADMIN_BANK_MATCH" }) }),
    );
    expect(db.bankStatementLine.updateMany.mock.calls[0][0].data).toMatchObject({ status: "MATCHED", matchedPaymentId: "p1" });
    expect(db.financeException.updateMany.mock.calls[0][0].where).toMatchObject({ type: "UNMATCHED_BANK_LINE", entityId: "line-1", status: "OPEN" });
    expect(recalcContractFunding).toHaveBeenCalledWith(db, "c1", expect.any(Date));
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: "FINANCE_EXCEPTION_RESOLVED", metadata: expect.objectContaining({ resolution: "MANUAL_BANK_MATCH" }) }));
  });

  it("another NGO's payment is 403 (tenant isolation)", async () => {
    db.contractPayment.findUnique.mockResolvedValue({ ...PAYMENT, contract: { ngoId: "ngo-2" } });
    expect((await post({ paymentId: "p1", note: "x" })).status).toBe(403);
    expect(db.contractPayment.updateMany).not.toHaveBeenCalled();
  });

  it("an amount mismatch is 422 — a partial match is a dispute, not a match", async () => {
    db.contractPayment.findUnique.mockResolvedValue({ ...PAYMENT, amount: D("999999.99") });
    expect((await post({ paymentId: "p1", note: "x" })).status).toBe(422);
  });

  it("replaying the same match is a no-op 200; a payment decided meanwhile is 409", async () => {
    db.bankStatementLine.findUnique.mockResolvedValue({ ...LINE, status: "MATCHED", matchedPaymentId: "p1" });
    const res = await post({ paymentId: "p1", note: "again" });
    expect(res.status).toBe(200);
    expect((await res.json()).replayed).toBe(true);
    expect(db.contractPayment.updateMany).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();

    db.bankStatementLine.findUnique.mockResolvedValue(LINE);
    db.contractPayment.updateMany.mockResolvedValue({ count: 0 });
    await expect(adminMatchBankLine({ lineId: "line-1", paymentId: "p1", adminId: "admin-1", note: "x" })).rejects.toMatchObject({ status: 409 });
  });
});
