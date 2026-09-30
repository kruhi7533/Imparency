import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  default: {
    reconciliationRun: { create: vi.fn(), update: vi.fn() },
    project: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    donation: { findMany: vi.fn() },
    ledgerEntry: { groupBy: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/finance-exceptions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/finance-exceptions")>(
    "@/lib/finance-exceptions",
  );
  return {
    ...actual,
    recordException: vi.fn(async () => "opened" as const),
    autoResolveExceptions: vi.fn(async () => 0),
  };
});
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import prisma from "@/lib/prisma";
import { recordException, autoResolveExceptions } from "@/lib/finance-exceptions";
import {
  compareCounterToLedger,
  netByKey,
  runReconciliation,
  stalePendingCutoff,
  STALE_PENDING_HOURS,
} from "@/lib/reconciliation";

const db = prisma as any;
const record = recordException as any;
const autoResolve = autoResolveExceptions as any;

/**
 * What these tests protect.
 *
 * Reconciliation is the check on everything else in the money path, so its own
 * failure modes are the dangerous ones: a comparison that tolerates drift, a
 * sign error that makes a refund look like income, and — worst — a run that
 * crashes halfway and still reads as a clean bill of health.
 */

const dec = (v: string) => new Prisma.Decimal(v);

beforeEach(() => {
  vi.clearAllMocks();
  db.reconciliationRun.create.mockResolvedValue({ id: "run_1" });
  db.reconciliationRun.update.mockResolvedValue({});
  db.project.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.donation.findMany.mockResolvedValue([]);
  db.ledgerEntry.groupBy.mockResolvedValue([]);
  db.ledgerEntry.findMany.mockResolvedValue([]);
  record.mockResolvedValue("opened");
  autoResolve.mockResolvedValue(0);
});

describe("comparing a counter against the ledger", () => {
  const base = { type: "PROJECT_TOTAL_MISMATCH" as const, entityType: "PROJECT" as const, entityId: "proj_1" };

  it("says nothing when they agree exactly", () => {
    expect(compareCounterToLedger({ ...base, counter: dec("1000.00"), ledger: dec("1000.00") })).toBeNull();
  });

  it("flags a one-paisa difference", () => {
    // No tolerance band: a tolerance is a decision about how much money may go
    // missing unnoticed.
    const finding = compareCounterToLedger({ ...base, counter: dec("1000.01"), ledger: dec("1000.00") });
    expect(finding).not.toBeNull();
    expect(finding!.detail).toMatchObject({ delta: "0.01", counterHigher: true });
  });

  it("reports which side is higher, because the two mean different things", () => {
    // Counter above ledger = we credited something we cannot prove we received
    // (a double-applied increment). Ledger above counter = we received money
    // the project was never credited with.
    const finding = compareCounterToLedger({ ...base, counter: dec("100.00"), ledger: dec("400.00") });
    expect(finding!.detail).toMatchObject({ counterHigher: false });
    expect(finding!.expectedAmount!.toFixed(2)).toBe("400.00");
    expect(finding!.observedAmount!.toFixed(2)).toBe("100.00");
  });

  it("carries no names or emails in its summary", () => {
    const finding = compareCounterToLedger({ ...base, counter: dec("1.00"), ledger: dec("2.00") });
    expect(finding!.summary).not.toMatch(/@/);
  });
});

describe("netByKey", () => {
  it("nets credits against debits per key", () => {
    const net = netByKey(
      [
        { projectId: "p1", direction: "CREDIT", _sum: { amount: dec("900.00") } },
        { projectId: "p1", direction: "DEBIT", _sum: { amount: dec("100.00") } },
        { projectId: "p2", direction: "CREDIT", _sum: { amount: dec("50.00") } },
      ] as never,
      "projectId",
    );
    expect(net.get("p1")!.toFixed(2)).toBe("800.00");
    expect(net.get("p2")!.toFixed(2)).toBe("50.00");
  });

  it("skips rows with a null key rather than bucketing them together", () => {
    const net = netByKey(
      [{ projectId: null, direction: "CREDIT", _sum: { amount: dec("10.00") } }] as never,
      "projectId",
    );
    expect(net.size).toBe(0);
  });
});

describe("stale pending threshold", () => {
  it("is measured backwards from now", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    expect(stalePendingCutoff(now).toISOString()).toBe("2026-09-29T12:00:00.000Z");
    expect(STALE_PENDING_HOURS).toBe(24);
  });
});

describe("a reconciliation run", () => {
  it("raises nothing when every total agrees", async () => {
    db.project.findMany.mockResolvedValue([{ id: "proj_1", raisedAmount: dec("500.00") }]);
    db.user.findMany.mockResolvedValue([{ id: "user_1", totalDonated: dec("500.00") }]);
    db.ledgerEntry.groupBy
      .mockResolvedValueOnce([{ projectId: "proj_1", direction: "CREDIT", _sum: { amount: dec("500.00") } }])
      .mockResolvedValueOnce([{ donorId: "user_1", direction: "CREDIT", _sum: { amount: dec("500.00") } }]);

    const result = await runReconciliation();

    expect(record).not.toHaveBeenCalled();
    expect(result.opened).toBe(0);
    expect(result.projectsChecked).toBe(1);
  });

  it("catches a project whose raised total was incremented twice", async () => {
    db.project.findMany.mockResolvedValue([{ id: "proj_1", raisedAmount: dec("1000.00") }]);
    db.ledgerEntry.groupBy
      .mockResolvedValueOnce([{ projectId: "proj_1", direction: "CREDIT", _sum: { amount: dec("500.00") } }])
      .mockResolvedValueOnce([]);

    await runReconciliation();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PROJECT_TOTAL_MISMATCH", entityId: "proj_1" }),
    );
  });

  it("catches a project credited with money the ledger never saw", async () => {
    // A project with a raised total and no ledger entries at all: the counter
    // must not be treated as self-evidently right just because the ledger is
    // empty for it.
    db.project.findMany.mockResolvedValue([{ id: "proj_1", raisedAmount: dec("750.00") }]);

    await runReconciliation();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PROJECT_TOTAL_MISMATCH", entityId: "proj_1" }),
    );
  });

  it("catches a confirmed donation with no ledger entry", async () => {
    db.donation.findMany
      .mockResolvedValueOnce([
        { id: "don_1", amount: dec("200.00"), projectId: "proj_1", razorpayPaymentId: "pay_1" },
      ])
      .mockResolvedValueOnce([]);
    db.ledgerEntry.findMany.mockResolvedValue([]);

    await runReconciliation();

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ type: "MISSING_LEDGER_ENTRY", entityId: "don_1" }),
    );
  });

  it("does not flag a confirmed donation that has its entry", async () => {
    db.donation.findMany
      .mockResolvedValueOnce([
        { id: "don_1", amount: dec("200.00"), projectId: "proj_1", razorpayPaymentId: "pay_1" },
      ])
      .mockResolvedValueOnce([]);
    db.ledgerEntry.findMany.mockResolvedValue([{ donationId: "don_1" }]);

    await runReconciliation();

    expect(record).not.toHaveBeenCalled();
    expect(autoResolve).toHaveBeenCalledWith("MISSING_LEDGER_ENTRY", ["don_1"], expect.any(String));
  });

  it("catches a donation left PENDING past the threshold", async () => {
    const old = new Date(Date.now() - 50 * 60 * 60 * 1000);
    db.donation.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "don_2", amount: dec("99.00"), projectId: "proj_1", createdAt: old }]);

    await runReconciliation();

    const call = record.mock.calls.find((c: any[]) => c[0].type === "STALE_PENDING_DONATION");
    expect(call).toBeTruthy();
    expect(call[0].entityId).toBe("don_2");
    expect(call[0].detail.ageHours).toBeGreaterThanOrEqual(50);
  });

  it("never auto-resolves an unmatched payment", async () => {
    // Nothing the reconciler can see proves an orphaned payment was dealt
    // with, so only a human may close one.
    await runReconciliation();

    const types = autoResolve.mock.calls.map((c: any[]) => c[0]);
    expect(types).not.toContain("UNMATCHED_PAYMENT");
  });

  it("records who asked for the run", async () => {
    await runReconciliation({ triggeredById: "admin_1" });
    expect(db.reconciliationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { triggeredById: "admin_1" } }),
    );
  });

  it("marks a crashed run as failed instead of letting it read as clean", async () => {
    db.project.findMany.mockRejectedValue(new Error("connection reset"));

    const result = await runReconciliation();

    expect(result.error).toBeTruthy();
    expect(db.reconciliationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_1" },
        data: expect.objectContaining({ error: "Reconciliation run failed" }),
      }),
    );
  });

  it("is safe to run twice: the second run opens nothing new", async () => {
    // The finding is unchanged, so recordException reports a recurrence rather
    // than a new row. A queue that grows per run is a queue nobody reads.
    db.project.findMany.mockResolvedValue([{ id: "proj_1", raisedAmount: dec("1000.00") }]);
    record.mockResolvedValueOnce("opened").mockResolvedValueOnce("recurred");

    const first = await runReconciliation();
    const second = await runReconciliation();

    expect(first.opened).toBe(1);
    expect(second.opened).toBe(0);
    expect(second.recurred).toBe(1);
  });
});
