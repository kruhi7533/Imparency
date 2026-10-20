import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bank-statement matching. A statement line reconciles a donor-recorded
 * contract payment only on reference + exact amount + date window; everything
 * less certain is left for a human. Covers parsing real-world CSV shapes, every
 * matching verdict, tenant/role isolation, re-upload idempotency and the
 * concurrent-decision race.
 */

const db = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
  bankStatementImport: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  bankStatementLine: { createMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  contractPayment: { findMany: vi.fn(), updateMany: vi.fn() },
  contractAuditLog: { create: vi.fn() },
  notification: { create: vi.fn(), createMany: vi.fn() },
  contract: { findMany: vi.fn() },
  project: { updateMany: vi.fn(), findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/finance-exceptions", () => ({ recordException: vi.fn(async () => "opened") }));

import { Prisma } from "@prisma/client";
import { recordException } from "@/lib/finance-exceptions";
import {
  importBankStatement,
  matchStatementLines,
  parseBankStatement,
  parseCsvRows,
  parseStatementAmount,
  parseStatementDate,
  rematchNgoStatements,
  statementLineHash,
} from "@/lib/bank-statement";

const NGO_OWNER = { id: "ngo-user-1", role: "NGO" };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const HDFC = [
  "HDFC BANK Ltd. Statement of account",
  "Account No : 50100123456789",
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "01/10/2026,OPENING BALANCE,,,,,\"1,00,000.00\"",
  "05/10/2026,NEFT CR-ACME0001-ACME INDUSTRIES-HOPEBRIDGE,UTR12345678,05/10/26,,\"50,000.00\",\"1,50,000.00\"",
  "06/10/2026,\"RENT, OCTOBER\",000123,06/10/26,\"20,000.00\",,\"1,30,000.00\"",
].join("\n");

const SBI = [
  "Txn Date,Description,Ref No,Amount,Cr/Dr",
  "05-Oct-2026,BY TRANSFER RTGS SBIN0000001 ACME,UTR99999999,\"2,00,000.00\",CR",
  "07-Oct-2026,ATM WDL,,500.00,DR",
].join("\n");

describe("parsing", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    expect(parseCsvRows('a,"b, c","say ""hi"""\n1,2,3')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("reads Indian date formats day-first and rejects impossible dates", () => {
    expect(parseStatementDate("05/10/2026")).toEqual(d("2026-10-05"));
    expect(parseStatementDate("05-10-26")).toEqual(d("2026-10-05"));
    expect(parseStatementDate("2026-10-05")).toEqual(d("2026-10-05"));
    expect(parseStatementDate("05-Oct-2026")).toEqual(d("2026-10-05"));
    expect(parseStatementDate("5 Sept 2026")).toEqual(d("2026-09-05"));
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("OPENING BALANCE")).toBeNull();
  });

  it("reads Indian-grouped amounts, currency marks and bracketed negatives", () => {
    expect(parseStatementAmount("1,20,000.00")?.toFixed(2)).toBe("120000.00");
    expect(parseStatementAmount("₹ 50,000")?.toFixed(2)).toBe("50000.00");
    expect(parseStatementAmount("(500.00)")?.toFixed(2)).toBe("-500.00");
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("n/a")).toBeNull();
  });

  it("HDFC-style Withdrawal/Deposit columns: finds the header under preamble rows, skips balances", () => {
    const { lines, skipped } = parseBankStatement(HDFC);
    expect(skipped).toBe(1); // opening balance
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ direction: "CREDIT", reference: "UTR12345678", valueDate: d("2026-10-05") });
    expect(lines[0].amount.toFixed(2)).toBe("50000.00");
    expect(lines[1]).toMatchObject({ direction: "DEBIT", description: "RENT, OCTOBER" });
  });

  it("SBI-style Amount + Cr/Dr columns", () => {
    const { lines } = parseBankStatement(SBI);
    expect(lines.map((l) => [l.direction, l.amount.toFixed(2)])).toEqual([
      ["CREDIT", "200000.00"],
      ["DEBIT", "500.00"],
    ]);
  });

  it("a file with no recognisable header is refused with guidance", () => {
    expect(() => parseBankStatement("foo,bar\n1,2")).toThrow(/Date column/);
  });
});

describe("matching", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    key: "l1",
    valueDate: d("2026-10-05"),
    amount: "50000.00",
    direction: "CREDIT",
    reference: "UTR12345678",
    description: "NEFT CR",
    ...over,
  });
  const pay = (over: Record<string, unknown> = {}) => ({ id: "p1", amount: "50000.00", reference: "UTR12345678", paidAt: d("2026-10-04"), ...over });

  it("MATCHED on reference + exact amount + date within the window", () => {
    expect(matchStatementLines([line()], [pay()]).get("l1")).toMatchObject({ status: "MATCHED", matchedPaymentId: "p1" });
  });

  it("finds the reference inside the narration when there is no reference column, ignoring spacing and case", () => {
    const r = matchStatementLines([line({ reference: null, description: "NEFT CR utr 1234-5678 ACME" })], [pay()]);
    expect(r.get("l1")?.status).toBe("MATCHED");
  });

  it("AMOUNT_MISMATCH when the reference is there but the amount differs — never reconciled", () => {
    const r = matchStatementLines([line({ amount: "45000.00" })], [pay()]).get("l1")!;
    expect(r).toMatchObject({ status: "AMOUNT_MISMATCH", matchedPaymentId: null, candidatePaymentIds: ["p1"] });
    expect(r.note).toMatch(/50000\.00.*45000\.00/);
  });

  it("AMBIGUOUS when two pending payments fit, or the dates are too far apart", () => {
    expect(matchStatementLines([line()], [pay(), pay({ id: "p2" })]).get("l1")?.status).toBe("AMBIGUOUS");
    const far = matchStatementLines([line()], [pay({ paidAt: d("2026-09-01") })]).get("l1")!;
    expect(far.status).toBe("AMBIGUOUS");
    expect(far.note).toMatch(/34 days apart/);
  });

  it("a payment claimed by two lines (duplicate credit) matches neither", () => {
    const r = matchStatementLines([line(), line({ key: "l2" })], [pay()]);
    expect(r.get("l1")?.status).toBe("AMBIGUOUS");
    expect(r.get("l2")?.status).toBe("AMBIGUOUS");
  });

  it("debits are never matched; unknown credits stay UNMATCHED; tiny references are ignored", () => {
    expect(matchStatementLines([line({ direction: "DEBIT" })], [pay()]).get("l1")?.status).toBe("DEBIT");
    expect(matchStatementLines([line({ reference: "OTHER999", description: "x" })], [pay()]).get("l1")?.status).toBe("UNMATCHED");
    expect(matchStatementLines([line({ description: "CR 12 AB" })], [pay({ reference: "12" })]).get("l1")?.status).toBe("UNMATCHED");
  });

  it("line hashes are stable, NGO-scoped, and separate identical lines in one file", () => {
    const parsed = { valueDate: d("2026-10-05"), description: "NEFT", reference: "UTR1", amount: new Prisma.Decimal("10"), direction: "CREDIT" as const };
    expect(statementLineHash("ngo-1", parsed, 0)).toBe(statementLineHash("ngo-1", parsed, 0));
    expect(statementLineHash("ngo-1", parsed, 0)).not.toBe(statementLineHash("ngo-2", parsed, 0));
    expect(statementLineHash("ngo-1", parsed, 0)).not.toBe(statementLineHash("ngo-1", parsed, 1));
  });
});

describe("import and reconcile", () => {
  const storedLine = { id: "line-1", valueDate: d("2026-10-05"), amount: new Prisma.Decimal("50000"), direction: "CREDIT", reference: "UTR12345678", description: "NEFT CR", createdAt: new Date() };
  const pendingPayment = {
    id: "pay-1",
    amount: new Prisma.Decimal("50000"),
    reference: "UTR12345678",
    paidAt: d("2026-10-04"),
    contractId: "c-1",
    contract: { donorId: "donor-1", contractNumber: "CTR-1", projectId: "proj-1" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-1" });
    db.nGOTeamMember.findFirst.mockResolvedValue(null);
    db.bankStatementImport.create.mockResolvedValue({ id: "imp-1" });
    db.bankStatementLine.createMany.mockResolvedValue({ count: 2 });
    db.bankStatementLine.findMany.mockResolvedValue([storedLine]);
    db.contractPayment.findMany.mockResolvedValue([pendingPayment]);
    db.contractPayment.updateMany.mockResolvedValue({ count: 1 });
    db.contract.findMany.mockResolvedValue([]);
  });

  it("the bank line that completes funding stamps the project FUNDED once and tells the parties", async () => {
    db.contract.findMany.mockResolvedValue([{ status: "ACTIVE", totalGrantAmount: 50000, payments: [{ amount: 50000, status: "RECONCILED" }] }]);
    db.project.updateMany.mockResolvedValue({ count: 1 });
    db.project.findUnique.mockResolvedValue({ title: "Digital classrooms", ngo: { userId: "ngo-user-1" }, contracts: [{ donorId: "donor-1" }] });
    await rematchNgoStatements("ngo-1", "ngo-user-1");
    expect(db.project.updateMany).toHaveBeenCalledWith({ where: { id: "proj-1", fundedAt: null }, data: { fundedAt: expect.any(Date) } });
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);

    // Already stamped (a re-run, or a manual confirmation got there first): nobody is told twice.
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
    db.bankStatementLine.findMany.mockResolvedValue([storedLine]);
    db.contractPayment.findMany.mockResolvedValue([pendingPayment]);
    db.contractPayment.updateMany.mockResolvedValue({ count: 1 });
    db.contract.findMany.mockResolvedValue([{ status: "ACTIVE", totalGrantAmount: 50000, payments: [{ amount: 50000, status: "RECONCILED" }] }]);
    db.project.updateMany.mockResolvedValue({ count: 0 });
    await rematchNgoStatements("ngo-1", "ngo-user-1");
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("a partial bank match does not fund the project", async () => {
    db.contract.findMany.mockResolvedValue([{ status: "ACTIVE", totalGrantAmount: 100000, payments: [{ amount: 50000, status: "RECONCILED" }] }]);
    await rematchNgoStatements("ngo-1", "ngo-user-1");
    expect(db.project.updateMany).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("reconciles a clear match: compare-and-swap, BANK_STATEMENT, audit row, donor told", async () => {
    const r = await importBankStatement({ user: NGO_OWNER, fileName: "oct.csv", content: HDFC });
    expect(r).toMatchObject({ lineCount: 2, newLines: 2, duplicateLines: 0, skippedRows: 1 });
    expect(r.matched).toEqual([{ paymentId: "pay-1", contractId: "c-1", amount: "50000.00", reference: "UTR12345678" }]);
    expect(db.contractPayment.updateMany).toHaveBeenCalledWith({
      where: { id: "pay-1", status: "PENDING_CONFIRMATION" },
      data: expect.objectContaining({ status: "RECONCILED", reconciledVia: "BANK_STATEMENT", confirmedById: "ngo-user-1" }),
    });
    expect(db.bankStatementLine.update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: expect.objectContaining({ status: "MATCHED", matchedPaymentId: "pay-1" }),
    });
    expect(db.contractAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contractId: "c-1", action: "PAYMENT_RECONCILED", metadata: expect.objectContaining({ via: "BANK_STATEMENT" }) }),
    });
    expect(db.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "donor-1" }) });
  });

  it("stores debits as DEBIT and credits as UNMATCHED before matching; skips lines seen before", async () => {
    db.bankStatementLine.createMany.mockResolvedValue({ count: 0 });
    const r = await importBankStatement({ user: NGO_OWNER, fileName: "oct.csv", content: HDFC });
    const data = db.bankStatementLine.createMany.mock.calls[0][0];
    expect(data.skipDuplicates).toBe(true);
    expect(data.data.map((x: any) => x.status)).toEqual(["UNMATCHED", "DEBIT"]);
    expect(r).toMatchObject({ newLines: 0, duplicateLines: 2 });
  });

  it("tenant scope: only this NGO's lines and this NGO's pending MANUAL payments are considered", async () => {
    await rematchNgoStatements("ngo-1", "ngo-user-1");
    expect(db.bankStatementLine.findMany.mock.calls[0][0].where).toMatchObject({ ngoId: "ngo-1", direction: "CREDIT" });
    expect(db.contractPayment.findMany.mock.calls[0][0].where).toEqual({
      status: "PENDING_CONFIRMATION",
      mode: "MANUAL",
      bankLine: null,
      contract: { ngoId: "ngo-1" },
    });
    // Matched lines are never re-examined.
    expect(db.bankStatementLine.findMany.mock.calls[0][0].where.status).toEqual({ in: ["UNMATCHED", "AMBIGUOUS", "AMOUNT_MISMATCH"] });
  });

  it("a payment decided by someone else meanwhile is not reconciled twice", async () => {
    db.contractPayment.updateMany.mockResolvedValue({ count: 0 });
    const r = await rematchNgoStatements("ngo-1", "ngo-user-1");
    expect(r.matched).toEqual([]);
    expect(db.contractAuditLog.create).not.toHaveBeenCalled();
    expect(db.bankStatementLine.update).toHaveBeenCalledWith({ where: { id: "line-1" }, data: expect.objectContaining({ status: "UNMATCHED" }) });
  });

  it("an amount mismatch is raised in the admin finance queue, and nothing is reconciled", async () => {
    db.bankStatementLine.findMany.mockResolvedValue([{ ...storedLine, amount: new Prisma.Decimal("45000") }]);
    const r = await rematchNgoStatements("ngo-1", "ngo-user-1");
    expect(r.amountMismatch).toBe(1);
    expect(db.contractPayment.updateMany).not.toHaveBeenCalled();
    expect(recordException).toHaveBeenCalledWith(
      expect.objectContaining({ type: "BANK_LINE_AMOUNT_MISMATCH", entityType: "CONTRACT_PAYMENT", entityId: "pay-1" })
    );
    // Ids and amounts only in the queue — no names.
    expect(JSON.stringify((recordException as any).mock.calls[0][0])).not.toMatch(/ACME|HOPEBRIDGE/i);
  });

  it("role isolation: field staff, donors and non-NGO users cannot upload (403)", async () => {
    db.nGOProfile.findUnique.mockResolvedValue(null);
    db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-1", role: "FIELD_STAFF" });
    await expect(importBankStatement({ user: { id: "staff-1", role: "NGO" }, fileName: "x.csv", content: HDFC })).rejects.toMatchObject({ status: 403 });
    await expect(importBankStatement({ user: { id: "donor-1", role: "DONOR" }, fileName: "x.csv", content: HDFC })).rejects.toMatchObject({ status: 403 });
    expect(db.bankStatementImport.create).not.toHaveBeenCalled();
  });

  it("a finance team member may upload", async () => {
    db.nGOProfile.findUnique.mockResolvedValue(null);
    db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-1", role: "FINANCE" });
    await importBankStatement({ user: { id: "fin-1", role: "NGO" }, fileName: "x.csv", content: HDFC });
    expect(db.bankStatementImport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ngoId: "ngo-1", uploadedById: "fin-1" }) });
  });

  it("an empty or unreadable statement is refused before anything is stored", async () => {
    await expect(importBankStatement({ user: NGO_OWNER, fileName: "x.csv", content: "Date,Narration,Deposit Amt.\nOPENING BALANCE,," })).rejects.toMatchObject({ status: 400 });
    expect(db.bankStatementImport.create).not.toHaveBeenCalled();
  });
});
