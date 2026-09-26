/**
 * Error capture for failures that are deliberately swallowed.
 *
 * A lot of this codebase catches an error, logs it, and carries on so a
 * secondary concern can't break a primary action — an audit-log write must not
 * fail an NGO approval, a health-score recalc must not fail a proof review.
 * That is the right behaviour, but it means those failures are invisible by
 * construction: `console.error` on Vercel is ephemeral and nobody is watching
 * it. `captureError` is the seam where those failures become *noticeable*.
 *
 * Two guarantees callers depend on:
 *   1. It never throws. It is called from inside catch blocks; if it could
 *      throw it would defeat the entire point.
 *   2. It never awaits network I/O on the request path. Webhook delivery is
 *      fire-and-forget so capturing an error can't slow down a donation.
 *
 * Wiring in a hosted provider later (Sentry et al) means adding one call in
 * `deliver()` — every call site stays exactly as it is.
 */

export type Severity = "warning" | "error" | "fatal";

export interface ErrorContext {
  /** Where this happened, e.g. "admin/review-proof" or "lib/admin-log". */
  scope: string;
  /** What the app was doing, e.g. "recalculate_health_score". */
  operation?: string;
  /** Entity the operation concerned. Ids only — never names, emails or amounts. */
  entityType?: string;
  entityId?: string;
  /** Acting user's id. Never their email or name. */
  userId?: string;
  /**
   * Anything else useful for triage. Keep it to ids, counts, enum values and
   * booleans — this goes to logs and possibly a third party, so no PII, no
   * document contents, no donation amounts tied to an identifiable donor.
   */
  extra?: Record<string, string | number | boolean | null>;
}

/** Prefix every captured line so it can be alerted on with one log filter. */
const LOG_PREFIX = "[capture]";

function normalizeError(error: unknown): {
  name: string;
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  return {
    name: "NonError",
    message: typeof error === "string" ? error : safeStringify(error),
    stack: null,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Forward to an external collector if one is configured. Fire-and-forget: the
 * promise is intentionally not awaited and its rejection is swallowed, so a
 * dead collector can never affect a user request.
 */
function deliver(payload: Record<string, unknown>): void {
  const endpoint = process.env.ERROR_WEBHOOK_URL;
  if (!endpoint) return;

  try {
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Don't let a slow collector hold a serverless function open.
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      /* collector unreachable — the structured log below is still the record */
    });
  } catch {
    /* fetch unavailable or payload unserializable — never surface this */
  }
}

/**
 * Record an error that the application has chosen to recover from.
 *
 * @example
 * try {
 *   await recalculateNGOHealthScore(ngoId);
 * } catch (err) {
 *   captureError(err, {
 *     scope: "admin/review-proof",
 *     operation: "recalculate_health_score",
 *     entityType: "NGO",
 *     entityId: ngoId,
 *   });
 * }
 */
export function captureError(
  error: unknown,
  context: ErrorContext,
  severity: Severity = "error"
): void {
  try {
    const normalized = normalizeError(error);

    const payload = {
      severity,
      capturedAt: new Date().toISOString(),
      environment: process.env.NODE_ENV ?? "unknown",
      ...context,
      error: normalized,
    };

    // Single-line JSON so log search and alerting can parse it. stderr, not
    // stdout, so it lands with the platform's other error output.
    console.error(`${LOG_PREFIX} ${JSON.stringify(payload)}`);

    deliver(payload);
  } catch {
    // Absolute last resort: capturing must never become the thing that breaks.
    console.error(`${LOG_PREFIX} failed to capture an error in scope=${context?.scope}`);
  }
}

/**
 * Convenience wrapper for the extremely common
 * "do this, but don't let it break the caller" shape.
 *
 * Returns the operation's value, or `fallback` if it threw.
 */
export async function captureAsync<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  fallback: T
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    captureError(err, context);
    return fallback;
  }
}
