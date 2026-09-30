import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import {
  CONFIRMATION_GRACE_DAYS,
  checkPayment,
  confirmationCutoff,
  fundingState,
  paidTotal,
} from "@/lib/allocation";

/**
 * What these tests protect.
 *
 * An allocation on its own is a promise. The whole point of this layer is that
 * the platform stops treating a promise as if it were money — so the failures
 * that matter are the ones that would let an unkept promise look kept:
 * confirming more than was committed, confirming against a commitment nobody
 * approved, back-dating or forward-dating a transfer, and a funding state that
 * rounds "partly paid" up to "paid".
 */

const dec = (v: string) => new Prisma.Decimal(v);

describe("funding state", () => {
  it("is UNFUNDED until something is confirmed", () => {
    expect(fundingState(dec("100000"), dec("0"))).toBe("UNFUNDED");
  });

  it("does not round a partial payment up to funded", () => {
    // One paisa short is still short. An organisation told it was funded would
    // plan against money that is not there.
    expect(fundingState(dec("100000.00"), dec("99999.99"))).toBe("PARTIALLY_FUNDED");
  });

  it("is FUNDED only on the exact amount", () => {
    expect(fundingState(dec("100000.00"), dec("100000.00"))).toBe("FUNDED");
  });

  it("surfaces OVERFUNDED rather than swallowing it", () => {
    // More arriving than was committed is either a duplicate confirmation or a
    // funder who sent too much. Both need a human.
    expect(fundingState(dec("100000.00"), dec("100000.01"))).toBe("OVERFUNDED");
  });

  it("adds tranches without going through a float", () => {
    const total = paidTotal([{ amount: "0.10" }, { amount: "0.20" }]);
    expect(total.toFixed(2)).toBe("0.30");
  });
});

describe("recording a confirmation", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const base = {
    allocationStatus: "APPROVED" as const,
    committed: dec("100000.00"),
    alreadyPaid: dec("0"),
    amount: dec("100000.00"),
    paidAt: new Date("2026-09-29T00:00:00Z"),
    now,
  };

  it("accepts a full confirmation against an approved commitment", () => {
    expect(checkPayment(base).ok).toBe(true);
  });

  it("accepts a tranche", () => {
    expect(checkPayment({ ...base, amount: dec("40000.00") }).ok).toBe(true);
  });

  it("refuses a commitment that was never approved", () => {
    // Money against a decision nobody took would create the appearance of
    // funding for a commitment that does not exist.
    for (const status of ["PENDING", "REJECTED"] as const) {
      const check = checkPayment({ ...base, allocationStatus: status });
      expect(check.refusal).toBe("ALLOCATION_NOT_APPROVED");
    }
  });

  it("refuses more than the commitment, counting what is already confirmed", () => {
    const check = checkPayment({
      ...base,
      alreadyPaid: dec("70000.00"),
      amount: dec("30000.01"),
    });
    expect(check.refusal).toBe("EXCEEDS_COMMITMENT");
    expect(check.message).toContain("30000.00");
  });

  it("allows the exact remainder", () => {
    expect(
      checkPayment({ ...base, alreadyPaid: dec("70000.00"), amount: dec("30000.00") }).ok,
    ).toBe(true);
  });

  it("refuses zero and negative amounts", () => {
    expect(checkPayment({ ...base, amount: dec("0") }).refusal).toBe("AMOUNT_NOT_POSITIVE");
    expect(checkPayment({ ...base, amount: dec("-100") }).refusal).toBe("AMOUNT_NOT_POSITIVE");
  });

  it("refuses a transfer dated in the future", () => {
    // A typo or a prediction — either way it would sit in the record as though
    // the money had already arrived.
    const check = checkPayment({ ...base, paidAt: new Date("2026-10-05T00:00:00Z") });
    expect(check.refusal).toBe("PAID_IN_THE_FUTURE");
  });

  it("allows a transfer dated in the past", () => {
    // Confirmations are usually entered days after the money moved.
    expect(checkPayment({ ...base, paidAt: new Date("2026-08-01T00:00:00Z") }).ok).toBe(true);
  });
});

describe("the confirmation deadline", () => {
  it("is measured backwards from now", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    expect(confirmationCutoff(now).toISOString()).toBe("2026-08-31T12:00:00.000Z");
    expect(CONFIRMATION_GRACE_DAYS).toBe(30);
  });
});
