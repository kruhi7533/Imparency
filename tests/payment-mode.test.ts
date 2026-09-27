import { describe, it, expect } from "vitest";
import { resolvePaymentMode } from "@/lib/payment-mode";

/**
 * What this protects.
 *
 * Mock mode is not "simulate a payment and stop". It writes the donation as
 * SUCCESS, increments raisedAmount and totalDonated, moves milestones to
 * IN_PROGRESS and issues an 80G tax receipt. Both donation routes used to enter
 * it on nothing more than `RAZORPAY_KEY_ID` being absent, which means a
 * production deploy that lost the variable would quietly mint tax receipts for
 * money nobody paid.
 */
const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv;

describe("resolvePaymentMode", () => {
  it("is LIVE when a real key is configured", () => {
    expect(resolvePaymentMode(env({ RAZORPAY_KEY_ID: "rzp_test_A1B2C3D4E5" }))).toEqual({
      mode: "LIVE",
    });
  });

  it("is LIVE in production with a real key", () => {
    expect(
      resolvePaymentMode(env({ RAZORPAY_KEY_ID: "rzp_live_A1B2C3D4E5", NODE_ENV: "production" }))
    ).toEqual({ mode: "LIVE" });
  });

  it("is MOCK in development with no key, so local dev still works", () => {
    expect(resolvePaymentMode(env({ NODE_ENV: "development" })).mode).toBe("MOCK");
  });

  it("is MOCK in test with no key", () => {
    expect(resolvePaymentMode(env({ NODE_ENV: "test" })).mode).toBe("MOCK");
  });

  it("treats the .env.example placeholders as absent, not as a key", () => {
    for (const placeholder of ["rzp_test_xxxxxxxxxxxx", "rzp_test_your_key_id"]) {
      expect(resolvePaymentMode(env({ RAZORPAY_KEY_ID: placeholder, NODE_ENV: "development" })).mode).toBe(
        "MOCK"
      );
    }
  });

  it("treats whitespace as absent", () => {
    expect(resolvePaymentMode(env({ RAZORPAY_KEY_ID: "   ", NODE_ENV: "development" })).mode).toBe("MOCK");
  });

  describe("production without credentials", () => {
    it("NEVER falls back to mock — that would issue receipts for unpaid money", () => {
      const result = resolvePaymentMode(env({ NODE_ENV: "production" }));
      expect(result.mode).toBe("MISCONFIGURED");
      expect(result.mode).not.toBe("MOCK");
    });

    it("is MISCONFIGURED for an empty key in production", () => {
      expect(resolvePaymentMode(env({ RAZORPAY_KEY_ID: "", NODE_ENV: "production" })).mode).toBe(
        "MISCONFIGURED"
      );
    });

    it("is MISCONFIGURED for a placeholder key in production", () => {
      // A deploy that shipped .env.example verbatim.
      expect(
        resolvePaymentMode(env({ RAZORPAY_KEY_ID: "rzp_test_your_key_id", NODE_ENV: "production" }))
          .mode
      ).toBe("MISCONFIGURED");
    });

    it("explains itself, because this lands in a log nobody is watching", () => {
      const result = resolvePaymentMode(env({ NODE_ENV: "production" }));
      if (result.mode !== "MISCONFIGURED") throw new Error("expected MISCONFIGURED");
      expect(result.reason).toContain("RAZORPAY_KEY_ID");
      expect(result.reason).toContain("tax receipt");
    });
  });
});
