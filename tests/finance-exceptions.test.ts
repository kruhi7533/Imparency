import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    financeException: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import prisma from "@/lib/prisma";
import {
  autoResolveExceptions,
  exceptionDedupeKey,
  recordException,
  recordUnmatchedPayment,
} from "@/lib/finance-exceptions";

const db = prisma as any;

/**
 * What these tests protect.
 *
 * Reconciliation is meant to be run often, so the exception queue's value
 * rests entirely on a re-run not duplicating what it already found — the same
 * lesson the fraud-alert queue learned the hard way, where one NGO showed nine
 * rows for three real defects. The opposite failure matters too: a finding
 * that was investigated, closed, and then came BACK must not be silently
 * folded into the old resolved row.
 */

beforeEach(() => {
  vi.clearAllMocks();
  db.financeException.findFirst.mockResolvedValue(null);
  db.financeException.count.mockResolvedValue(0);
  db.financeException.create.mockResolvedValue({ id: "exc_1" });
  db.financeException.update.mockResolvedValue({ id: "exc_1" });
  db.financeException.updateMany.mockResolvedValue({ count: 0 });
});

const finding = {
  type: "PROJECT_TOTAL_MISMATCH" as const,
  entityType: "PROJECT" as const,
  entityId: "proj_1",
  summary: "Counter 500.00 vs ledger 300.00 (delta 200.00)",
};

describe("recording a finding", () => {
  it("opens a new exception when nothing is open for that subject", async () => {
    const outcome = await recordException(finding);

    expect(outcome).toBe("opened");
    expect(db.financeException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "PROJECT_TOTAL_MISMATCH",
        entityId: "proj_1",
        dedupeKey: "PROJECT_TOTAL_MISMATCH:proj_1",
      }),
    });
  });

  it("bumps the open row instead of creating a second one", async () => {
    db.financeException.findFirst.mockResolvedValue({ id: "exc_existing" });

    const outcome = await recordException(finding);

    expect(outcome).toBe("recurred");
    expect(db.financeException.create).not.toHaveBeenCalled();
    expect(db.financeException.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exc_existing" },
        data: expect.objectContaining({ occurrences: { increment: 1 } }),
      }),
    );
  });

  it("opens a NEW row when the same discrepancy recurs after a resolution", async () => {
    // Nothing open, but one resolved row exists. "We closed this and it came
    // back" is a different fact from "still open", and reopening the old row
    // would erase the first investigation's outcome.
    db.financeException.findFirst.mockResolvedValue(null);
    db.financeException.count.mockResolvedValue(1);

    const outcome = await recordException(finding);

    expect(outcome).toBe("opened");
    expect(db.financeException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dedupeKey: "PROJECT_TOTAL_MISMATCH:proj_1:1" }),
    });
  });

  it("treats a lost race on the unique key as a recurrence, not a crash", async () => {
    // Two reconciler runs overlapped. The other one opened the row; this run
    // has nothing to add and must not fail the whole reconciliation.
    db.financeException.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(recordException(finding)).resolves.toBe("recurred");
  });

  it("does not swallow a real database failure", async () => {
    db.financeException.create.mockRejectedValue(
      Object.assign(new Error("connection reset"), { code: "P1001" }),
    );

    await expect(recordException(finding)).rejects.toThrow("connection reset");
  });
});

describe("dedupe keys", () => {
  it("has no suffix on the first generation, so the common case stays readable", () => {
    expect(exceptionDedupeKey("UNMATCHED_PAYMENT", "pay_1")).toBe("UNMATCHED_PAYMENT:pay_1");
    expect(exceptionDedupeKey("UNMATCHED_PAYMENT", "pay_1", 2)).toBe("UNMATCHED_PAYMENT:pay_1:2");
  });
});

describe("auto-resolution", () => {
  it("closes only rows that are still OPEN, and attributes them to the platform", async () => {
    db.financeException.updateMany.mockResolvedValue({ count: 2 });

    const closed = await autoResolveExceptions(
      "PROJECT_TOTAL_MISMATCH",
      ["proj_1", "proj_2"],
      "matched on a later run",
    );

    expect(closed).toBe(2);
    const arg = db.financeException.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ status: "OPEN", entityId: { in: ["proj_1", "proj_2"] } });
    // resolvedById stays unset: no person closed this.
    expect(arg.data.resolvedById).toBeUndefined();
  });

  it("does nothing at all when no subject balances", async () => {
    await autoResolveExceptions("PROJECT_TOTAL_MISMATCH", [], "note");
    expect(db.financeException.updateMany).not.toHaveBeenCalled();
  });
});

describe("unmatched payments", () => {
  it("converts the provider's paise to rupees", async () => {
    await recordUnmatchedPayment({ id: "pay_1", amount: 250000, currency: "INR" }, "order_1");

    const data = db.financeException.create.mock.calls[0][0].data;
    expect(data.entityId).toBe("pay_1");
    expect(data.observedAmount.toFixed(2)).toBe("2500.00");
    expect(data.summary).toContain("2500.00");
  });

  it("still records the payment when the amount is missing", async () => {
    // A payload we cannot read is more alarming than one we can, not less —
    // dropping it would put us back to losing the payment silently.
    await recordUnmatchedPayment({ id: "pay_2" }, "order_2");

    const data = db.financeException.create.mock.calls[0][0].data;
    expect(data.observedAmount).toBeNull();
    expect(data.summary).toContain("amount not reported");
  });

  it("falls back to the order id when the payload has no payment id", async () => {
    await recordUnmatchedPayment({ amount: 100 }, "order_3");

    expect(db.financeException.create.mock.calls[0][0].data.entityId).toBe("order:order_3");
  });

  it("carries no donor identity into the queue", async () => {
    await recordUnmatchedPayment(
      { id: "pay_4", amount: 100, currency: "INR" },
      "order_4",
    );

    const data = db.financeException.create.mock.calls[0][0].data;
    // Ids and amounts only — this queue is read by admins who may not be
    // entitled to the underlying PII, and it outlives PII retention.
    expect(JSON.stringify(data)).not.toMatch(/@/);
  });
});
