import crypto from "crypto";

/**
 * Shared HMAC verification for every Razorpay webhook we expose.
 *
 * There are two webhook routes today (`api/donations/webhook` and
 * `api/crisis/webhook`) and both used to compare digests with `!==`. A plain
 * string compare short-circuits on the first differing byte, which leaks how
 * much of a forged signature was correct and makes the secret guessable one
 * byte at a time. `crypto.timingSafeEqual` always reads both buffers fully.
 *
 * It lives here rather than being fixed twice so a third webhook can't
 * reintroduce the same bug by copying whichever route it was pasted from.
 * `app/api/cron/*` already verifies its shared secret this way.
 */
export function verifyRazorpaySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  // timingSafeEqual throws on a length mismatch, so the cheap length check has
  // to come first. Comparing lengths is not a leak: the digest length is fixed
  // and public (64 hex chars for SHA-256), so a wrong length tells an attacker
  // only that they failed to send a SHA-256 digest at all.
  if (expected.length !== signature.length) return false;

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
