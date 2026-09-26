import { MODEL_RETRY_DELAYS_MS } from "./config";

/** Transport-only retry — a smaller copy of the same policy the deleted
 * caseworker used, kept local so this module has no dependency on lib/agent. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_HINTS = [
  "timeout",
  "econnreset",
  "fetch failed",
  "overloaded",
  "unavailable",
  "rate limit",
  "resource_exhausted",
  // Groq's 400 for a model that emitted malformed tool-call JSON — a sampling
  // glitch, not a genuine bad request. Observed on openai/gpt-oss-120b: one
  // call failed this way, a bare resend of the same turn succeeded. Retrying
  // is safe because the request itself is unchanged, only what the model
  // generates in response to it.
  "tool_use_failed",
];

function isRetryable(err: any): boolean {
  const status = err?.status ?? err?.response?.status;
  if (typeof status === "number" && RETRYABLE_STATUS.has(status)) return true;
  const message = String(err?.message ?? err ?? "").toLowerCase();
  return RETRYABLE_HINTS.some((h) => message.includes(h));
}

/**
 * Never sleep longer than this on one retry, however long the provider asks for.
 *
 * This agent runs synchronously inside an HTTP request, so an uncapped sleep is
 * a hang: the wall-clock guard in run.ts is only checked between steps, and
 * cannot interrupt a sleep already in progress. Groq's free tier enforces a
 * TOKENS-per-minute limit (12k) that a tool-calling loop hits easily, and its
 * Retry-After can exceed a minute — without this cap a single 429 stalled a run
 * past five minutes with no way to abort.
 */
const MAX_SERVER_DELAY_MS = 20_000;

function serverDelayMs(err: any): number | null {
  // OpenAI-compatible providers (Groq, OpenRouter) surface this as a
  // Retry-After HTTP header, already converted to milliseconds when the fetch
  // wrapper threw — see providers/openai-compatible-provider.ts.
  if (typeof err?.retryAfterMs === "number" && err.retryAfterMs > 0) {
    return Math.min(err.retryAfterMs, MAX_SERVER_DELAY_MS);
  }

  // Gemini embeds it in the error body as JSON instead.
  const match = String(err?.message ?? "").match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!match) return null;
  const seconds = Number.parseFloat(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.ceil(seconds * 1000) + 1000, MAX_SERVER_DELAY_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withModelRetry<T>(fn: () => Promise<T>, delays = MODEL_RETRY_DELAYS_MS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= delays.length || !isRetryable(err)) throw err;
      const server = serverDelayMs(err);
      await sleep(server === null ? Math.random() * delays[attempt] : Math.max(server, Math.random() * delays[attempt]));
    }
  }
  throw lastError;
}
