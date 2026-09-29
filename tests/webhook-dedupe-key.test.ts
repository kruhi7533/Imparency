import { describe, it, expect } from "vitest";
import { webhookDedupeKey, isUniqueConstraintError } from "@/lib/razorpay-webhook";

/**
 * These pin the ONE decision that makes the payment webhook safe: what counts
 * as "the same webhook". Get it wrong in either direction and the failure is
 * financial — too loose and a payment applies twice, too tight and a legitimate
 * second payment is dropped on the floor.
 */
describe("webhookDedupeKey", () => {
  it("keys on the payment, so a redelivery of the same payment collides", () => {
    // Razorpay retries a failed delivery with a FRESH event id. If the key were
    // built from the delivery id, the retry would look new and apply the money
    // a second time — the exact bug this exists to prevent.
    expect(webhookDedupeKey("payment.captured", "pay_999")).toBe(
      webhookDedupeKey("payment.captured", "pay_999")
    );
  });

  it("separates two different payments", () => {
    // A donor giving twice to the same project is two payments and must not be
    // deduped into one.
    expect(webhookDedupeKey("payment.captured", "pay_1")).not.toBe(
      webhookDedupeKey("payment.captured", "pay_2")
    );
  });

  it("separates capture from failure for one payment", () => {
    // A payment can fail and later be captured. Sharing a key would let the
    // first outcome block the second from ever being recorded.
    expect(webhookDedupeKey("payment.captured", "pay_1")).not.toBe(
      webhookDedupeKey("payment.failed", "pay_1")
    );
  });

  it("separates providers", () => {
    expect(webhookDedupeKey("payment.captured", "pay_1", "stripe")).not.toBe(
      webhookDedupeKey("payment.captured", "pay_1", "razorpay")
    );
  });

  it("defaults to razorpay and is readable in the database", () => {
    // Deliberately human-inspectable: reconciliation work this week will read
    // these rows by eye against a Razorpay settlement export.
    expect(webhookDedupeKey("payment.captured", "pay_999")).toBe("razorpay:payment.captured:pay_999");
  });
});

describe("isUniqueConstraintError", () => {
  it("recognises Prisma's P2002", () => {
    expect(isUniqueConstraintError(Object.assign(new Error("dup"), { code: "P2002" }))).toBe(true);
  });

  it("rejects other Prisma errors", () => {
    // P1001 is a connection failure: the write may never have landed, so it
    // must NOT be reported to Razorpay as an already-applied duplicate.
    expect(isUniqueConstraintError(Object.assign(new Error("down"), { code: "P1001" }))).toBe(false);
  });

  it("rejects a plain error, null and undefined without throwing", () => {
    expect(isUniqueConstraintError(new Error("boom"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
  });
});
