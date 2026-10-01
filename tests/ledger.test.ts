import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  donationCapturedEntry,
  ledgerIdempotencyKey,
  netAmount,
  paymentOccurredAt,
} from "@/lib/ledger";

/**
 * What these tests protect.
 *
 * The ledger is the only record that can contradict a running counter, so its
 * arithmetic and its idempotency key are load-bearing. Three ways it could
 * quietly become useless: signs applied wrongly (a refund counted as income),
 * a key that lets one payment land twice, and an invalid occurredAt written
 * into a row nothing is allowed to edit afterwards.
 */

describe("the idempotency key", () => {
  it("is keyed on the payment, so one payment can only ever land once", () => {
    expect(ledgerIdempotencyKey("DONATION_CAPTURED", "pay_1")).toBe("DONATION_CAPTURED:pay_1");
  });

  it("separates entry types for the same payment", () => {
    // A capture and its refund both name the same payment, and both must be
    // recordable. Dropping the type from the key would silently swallow the
    // refund.
    expect(ledgerIdempotencyKey("DONATION_CAPTURED", "pay_1")).not.toBe(
      ledgerIdempotencyKey("DONATION_REFUNDED", "pay_1"),
    );
  });
});

describe("donationCapturedEntry", () => {
  const args = {
    donationId: "don_1",
    projectId: "proj_1",
    ngoId: "ngo_1",
    donorId: "user_1",
    amount: "1500.50",
    paymentId: "pay_1",
    occurredAt: new Date("2026-09-30T10:00:00.000Z"),
  };

  it("is a positive CREDIT carrying every id the reconciler needs", () => {
    const entry = donationCapturedEntry(args);
    expect(entry.direction).toBe("CREDIT");
    expect(new Prisma.Decimal(entry.amount as Prisma.Decimal).toFixed(2)).toBe("1500.50");
    expect(entry).toMatchObject({
      entryType: "DONATION_CAPTURED",
      projectId: "proj_1",
      donorId: "user_1",
      donationId: "don_1",
      externalRef: "pay_1",
      idempotencyKey: "DONATION_CAPTURED:pay_1",
    });
  });

  it("keeps the amount exact rather than routing it through a float", () => {
    // 0.1 + 0.2 arithmetic in the money path is how paisa go missing.
    const entry = donationCapturedEntry({ ...args, amount: "0.1" });
    expect(new Prisma.Decimal(entry.amount as Prisma.Decimal).plus("0.2").toFixed(2)).toBe("0.30");
  });

  it("records when the money moved, not when we heard about it", () => {
    const entry = donationCapturedEntry(args);
    expect(entry.occurredAt).toEqual(new Date("2026-09-30T10:00:00.000Z"));
  });
});

describe("paymentOccurredAt", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");

  it("reads the provider's unix SECONDS", () => {
    expect(paymentOccurredAt(1759228800, now)).toEqual(new Date(1759228800 * 1000));
  });

  it("falls back to now rather than writing an invalid date", () => {
    // An immutable row with occurredAt = Invalid Date can never be corrected.
    for (const bad of [undefined, null, "1759228800", NaN, 0, -5]) {
      expect(paymentOccurredAt(bad, now)).toEqual(now);
    }
  });
});

describe("netAmount", () => {
  it("subtracts debits instead of adding them", () => {
    const net = netAmount([
      { direction: "CREDIT", amount: "1000.00" },
      { direction: "CREDIT", amount: "500.25" },
      { direction: "DEBIT", amount: "200.25" },
    ]);
    expect(net.toFixed(2)).toBe("1300.00");
  });

  it("is zero for no entries, not null", () => {
    expect(netAmount([]).toFixed(2)).toBe("0.00");
  });

  it("can go negative when more was refunded than received", () => {
    const net = netAmount([
      { direction: "CREDIT", amount: "100.00" },
      { direction: "DEBIT", amount: "250.00" },
    ]);
    expect(net.toFixed(2)).toBe("-150.00");
  });
});
