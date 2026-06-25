import crypto from "crypto";

/**
 * Generates a cryptographically secure one-time token.
 */
export function generateRetryToken(): string {
  return crypto.randomBytes(32).toString("hex"); // 64-char hex string
}

/**
 * Returns delay in milliseconds before the next retry attempt.
 * Exponential back-off:
 *   retryCount 0 (first failure): 30 seconds
 *   retryCount 1 (second failure): 2 minutes
 *   retryCount >= 2: -1 (exhausted)
 */
export function getRetryDelay(retryCount: number): number {
  if (retryCount === 0) return 30_000;
  if (retryCount === 1) return 120_000;
  return -1;
}
