import { INVESTIGATOR_RPM, INVESTIGATOR_TPM } from "./config";

/**
 * In-process requests-per-minute throttle, shared by every investigation
 * running in this process — the limit belongs to the PROVIDER account, not to
 * any one run, so two investigations racing each other must share one budget,
 * not each get their own.
 *
 * This is deliberately separate from withModelRetry's backoff in retry.ts:
 * that one reacts AFTER a 429 already happened. This one tries to avoid
 * causing the 429 in the first place, which matters more on a free tier where
 * a burst of calls (e.g. several HIGH alerts firing investigations back to
 * back) can blow the daily quota on retries alone.
 *
 * Sliding window over a plain in-memory array — correct for a single Node
 * process on a real server (see docs on deployment target), which is exactly
 * what this runs on. Resets on restart, which is fine: the limit is "don't
 * burst", not "track lifetime usage".
 */
const callTimestamps: number[] = [];

/** Actual token spend, so the throttle can respect a tokens-per-minute cap. */
const tokenEvents: { at: number; tokens: number }[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function prune(now: number): void {
  while (callTimestamps.length > 0 && now - callTimestamps[0] > 60_000) callTimestamps.shift();
  while (tokenEvents.length > 0 && now - tokenEvents[0].at > 60_000) tokenEvents.shift();
}

function tokensInWindow(now: number): number {
  return tokenEvents.reduce((sum, e) => (now - e.at <= 60_000 ? sum + e.tokens : sum), 0);
}

export async function acquireModelSlot(): Promise<void> {
  while (true) {
    const now = Date.now();
    prune(now);

    const requestsOk = callTimestamps.length < INVESTIGATOR_RPM;

    // Tokens-per-minute is the limit that actually binds a tool-calling loop:
    // every turn resends the whole history, so late steps are far larger than
    // early ones. Groq's free tier allows 12k TPM — roughly five late-stage
    // calls — which a request-only throttle sails straight past into a 429.
    // Reserving a step's worth of headroom means we wait BEFORE the call that
    // would breach, rather than discovering it afterwards.
    const spent = tokensInWindow(now);
    const tokensOk = INVESTIGATOR_TPM <= 0 || spent + estimatedNextCallTokens() <= INVESTIGATOR_TPM;

    if (requestsOk && tokensOk) {
      callTimestamps.push(now);
      return;
    }

    const waits: number[] = [];
    if (!requestsOk) waits.push(60_000 - (now - callTimestamps[0]) + 50);
    if (!tokensOk && tokenEvents.length > 0) waits.push(60_000 - (now - tokenEvents[0].at) + 50);
    await sleep(Math.max(waits.length ? Math.min(...waits) : 1_000, 50));
  }
}

/**
 * How many tokens to reserve for the call we are about to make. Falls back to a
 * deliberately pessimistic figure before any data exists — under-reserving
 * causes the 429 this exists to avoid.
 *
 * Deliberately NOT the plain rolling average. Every turn of a tool-calling loop
 * resends the whole history plus one more tool result, so per-call spend grows
 * monotonically: the mean of a run always sits below the call that is about to
 * happen, and reserving the mean systematically under-reserves at exactly the
 * late steps where the budget is tightest. Observed on 2026-08-16: a run had
 * spent 7,503 tokens in the window and asked for 2,830 more — a step nearly
 * double the mean of the steps before it.
 *
 * Taking the larger of the mean and the most recent call keeps the pessimism
 * where the growth is, without over-reserving on a run whose steps happen to
 * shrink.
 */
function estimatedNextCallTokens(): number {
  if (tokenEvents.length === 0) return 3_000;
  const total = tokenEvents.reduce((sum, e) => sum + e.tokens, 0);
  const mean = Math.ceil(total / tokenEvents.length);
  const mostRecent = tokenEvents[tokenEvents.length - 1].tokens;
  return Math.max(mean, mostRecent);
}

/** Called after each model call with its real usage. */
export function recordTokenUsage(tokens: number): void {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  tokenEvents.push({ at: Date.now(), tokens });
}

/** Test/ops visibility: how many calls are counted in the current window. */
export function currentWindowCount(): number {
  const now = Date.now();
  return callTimestamps.filter((t) => now - t <= 60_000).length;
}

/** Test/ops visibility: tokens counted in the current window. */
export function currentWindowTokens(): number {
  return tokensInWindow(Date.now());
}
