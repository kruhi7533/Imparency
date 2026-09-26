/**
 * Is this request allowed to take a mock payment?
 *
 * ─── Why this is not a one-line env check ─────────────────────────────────
 *
 * Both donation routes used to decide it inline, like this:
 *
 *   const isMock = !process.env.RAZORPAY_KEY_ID || ...placeholder... ;
 *
 * which FAILS OPEN. Mock mode does not simulate a payment and stop — it writes
 * the donation as SUCCESS, increments `raisedAmount` and `totalDonated`, moves
 * milestones to IN_PROGRESS and issues an 80G tax receipt. All of that on the
 * strength of an environment variable being absent.
 *
 * So a production deploy that lost `RAZORPAY_KEY_ID` — a rotated secret, a
 * typo, a missing value in a new environment — would not error. It would
 * quietly start minting tax receipts for money nobody ever paid, and the first
 * person to notice would be a donor filing an 80G claim against a receipt with
 * no payment behind it.
 *
 * Absence of configuration is never permission. In production, missing
 * credentials are a fault to be reported, not a mode to fall into.
 */

export type PaymentMode =
  /** Real Razorpay credentials are present. Take the payment for real. */
  | { mode: "LIVE" }
  /** Non-production with no credentials — simulate, as local dev needs. */
  | { mode: "MOCK" }
  /** Production with no credentials. The caller MUST refuse the request. */
  | { mode: "MISCONFIGURED"; reason: string };

/** The placeholder shipped in .env.example, which is not a real credential. */
function isPlaceholder(value: string): boolean {
  return value.includes("xxxxxxxxxxxx") || value.includes("your_key_id");
}

export function resolvePaymentMode(env: NodeJS.ProcessEnv = process.env): PaymentMode {
  const keyId = env.RAZORPAY_KEY_ID?.trim();
  const configured = !!keyId && !isPlaceholder(keyId);

  if (configured) return { mode: "LIVE" };

  // NODE_ENV is set to "production" by `next build`/`next start`, so this is
  // the same signal the rest of the framework trusts.
  if (env.NODE_ENV === "production") {
    return {
      mode: "MISCONFIGURED",
      reason:
        "RAZORPAY_KEY_ID is not configured. Refusing the donation rather than " +
        "falling back to mock mode, which would record it as paid and issue a tax receipt.",
    };
  }

  return { mode: "MOCK" };
}
