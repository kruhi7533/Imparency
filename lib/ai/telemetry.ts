import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCorrelationId } from "@/lib/request-context";
import { getAiFaultMode } from "@/lib/ai/fault-injection";

/**
 * The one wrapper every model call goes through (AI-009 / AI-010).
 *
 *   const response = await callAi(
 *     { site: "draft-ngo-nudge", model, promptVersion: "v1" },
 *     () => ai.models.generateContent({ model, contents: [prompt] }),
 *   );
 *
 * It adds three things and changes nothing else about the call:
 *  1. A TIME BUDGET (AI_TIMEOUT_MS, default 60s, or meta.timeoutMs). A call that
 *     overruns rejects with AiUnavailableError("TIMEOUT"); the abort signal is
 *     handed to the call so a provider that supports it can stop work too.
 *  2. FAULT INJECTION (lib/ai/fault-injection.ts): when active, the call is not
 *     made at all and rejects with AiUnavailableError, so every caller's
 *     degraded path can be exercised on purpose.
 *  3. TELEMETRY: one AiCallLog row per call — site, model, prompt version,
 *     latency, token usage when the provider reports it, a cost ESTIMATE, the
 *     outcome (OK / ERROR / TIMEOUT) and whether the fault was injected. Never
 *     the prompt or response text. A telemetry write failure never fails the call.
 *
 * Provider errors are re-thrown unchanged (retry helpers inspect status codes);
 * only timeouts and injected faults become AiUnavailableError. Callers already
 * catch model errors — each must degrade to an explicit "AI unavailable —
 * human review required" state, never a 500 and never invented output.
 */

export const AI_UNAVAILABLE_MESSAGE = "AI unavailable — human review required";

export type AiFailureKind = "TIMEOUT" | "ERROR";

export class AiUnavailableError extends Error {
  readonly kind: AiFailureKind;
  readonly site: string;
  readonly faultInjected: boolean;
  constructor(kind: AiFailureKind, site: string, faultInjected: boolean) {
    // Worded to avoid the transport-retry hint words ("timeout", "unavailable"):
    // an injected fault or a blown budget must not be retried into a longer hang.
    super(
      faultInjected
        ? `Model call for ${site} failed by fault injection (${kind}); human review required`
        : `Model call for ${site} exceeded its time budget; human review required`
    );
    this.name = "AiUnavailableError";
    this.kind = kind;
    this.site = site;
    this.faultInjected = faultInjected;
  }
}

export type AiProvider = "gemini" | "anthropic" | "openai-compatible" | "rules";

export interface AiCallMeta {
  /** Stable call-site key, e.g. "screen-project". */
  site: string;
  /** Defaults to "gemini" — most call sites. */
  provider?: AiProvider;
  model: string;
  /** Bump when the prompt text changes, so runs can be compared per version. */
  promptVersion: string;
  timeoutMs?: number;
}

export interface AiUsage {
  tokensIn: number | null;
  tokensOut: number | null;
}

/** Usage from @google/genai, @google/generative-ai or an OpenAI-compatible body. */
export function usageOf(result: any): AiUsage {
  const u = result?.usageMetadata ?? result?.response?.usageMetadata ?? null;
  if (u) {
    const out = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    return { tokensIn: u.promptTokenCount ?? null, tokensOut: u.candidatesTokenCount == null && u.thoughtsTokenCount == null ? null : out };
  }
  const o = result?.usage ?? null;
  if (o && (o.input_tokens != null || o.output_tokens != null)) {
    // Anthropic Messages API: cache reads/writes are input too.
    const input = (o.input_tokens ?? 0) + (o.cache_read_input_tokens ?? 0) + (o.cache_creation_input_tokens ?? 0);
    return { tokensIn: input, tokensOut: o.output_tokens ?? null };
  }
  if (o) return { tokensIn: o.prompt_tokens ?? null, tokensOut: o.completion_tokens ?? null };
  return { tokensIn: null, tokensOut: null };
}

/**
 * USD per 1M tokens [input, output] — an ESTIMATE for trend-watching, not
 * billing. Override or extend with AI_PRICE_TABLE='{"model-name":[in,out]}'.
 */
const DEFAULT_PRICES: Array<[RegExp, [number, number]]> = [
  [/claude-opus/i, [5, 25]],
  [/claude-sonnet/i, [3, 15]],
  [/claude-haiku/i, [1, 5]],
  [/flash-lite/i, [0.1, 0.4]],
  [/flash/i, [0.3, 2.5]],
  [/pro/i, [1.25, 10]],
];

export function estimateCostUsd(model: string, usage: AiUsage): number | null {
  if (usage.tokensIn == null && usage.tokensOut == null) return null;
  let price: [number, number] | null = null;
  try {
    const table = process.env.AI_PRICE_TABLE ? JSON.parse(process.env.AI_PRICE_TABLE) : null;
    if (table && Array.isArray(table[model])) price = table[model];
  } catch {
    price = null;
  }
  if (!price) price = DEFAULT_PRICES.find(([re]) => re.test(model))?.[1] ?? null;
  if (!price) return null;
  const cost = ((usage.tokensIn ?? 0) * price[0] + (usage.tokensOut ?? 0) * price[1]) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function defaultTimeoutMs(): number {
  const n = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

async function record(row: {
  meta: AiCallMeta;
  outcome: "OK" | "ERROR" | "TIMEOUT";
  faultInjected: boolean;
  latencyMs: number;
  usage: AiUsage;
  errorCode: string | null;
}): Promise<void> {
  try {
    const cost = row.outcome === "OK" ? estimateCostUsd(row.meta.model, row.usage) : null;
    await prisma.aiCallLog.create({
      data: {
        site: row.meta.site,
        provider: row.meta.provider ?? "gemini",
        model: row.meta.model,
        promptVersion: row.meta.promptVersion,
        outcome: row.outcome,
        faultInjected: row.faultInjected,
        latencyMs: Math.max(0, Math.round(row.latencyMs)),
        tokensIn: row.usage.tokensIn,
        tokensOut: row.usage.tokensOut,
        costUsd: cost === null ? null : new Prisma.Decimal(cost.toFixed(6)),
        errorCode: row.errorCode,
        correlationId: (getCorrelationId() as string | null) ?? null,
      },
    });
  } catch (err) {
    console.error("[ai/telemetry] could not record AI call:", (err as Error)?.message ?? err);
  }
}

function errorCodeOf(err: any): string {
  const status = err?.status ?? err?.response?.status ?? err?.code;
  return String(status ?? err?.name ?? "Error").slice(0, 60);
}

export async function callAi<T>(meta: AiCallMeta, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const fault = await getAiFaultMode();
  if (fault) {
    const kind: AiFailureKind = fault === "timeout" ? "TIMEOUT" : "ERROR";
    await record({ meta, outcome: kind, faultInjected: true, latencyMs: 0, usage: { tokensIn: null, tokensOut: null }, errorCode: `FAULT_INJECTED_${kind}` });
    throw new AiUnavailableError(kind, meta.site, true);
  }

  const started = Date.now();
  const controller = new AbortController();
  const budget = meta.timeoutMs ?? defaultTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AiUnavailableError("TIMEOUT", meta.site, false));
    }, budget);
  });

  try {
    const result = await Promise.race([fn(controller.signal), timeout]);
    await record({ meta, outcome: "OK", faultInjected: false, latencyMs: Date.now() - started, usage: usageOf(result), errorCode: null });
    return result;
  } catch (err) {
    const isTimeout = err instanceof AiUnavailableError && err.kind === "TIMEOUT";
    await record({
      meta,
      outcome: isTimeout ? "TIMEOUT" : "ERROR",
      faultInjected: false,
      latencyMs: Date.now() - started,
      usage: { tokensIn: null, tokensOut: null },
      errorCode: isTimeout ? "TIMEOUT" : errorCodeOf(err),
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** True for an error that means "the model did not answer" (timeout / injected fault). */
export function isAiUnavailable(err: unknown): err is AiUnavailableError {
  return err instanceof AiUnavailableError;
}

/**
 * Record a deterministic, no-model run (provider "rules"), e.g. NGO field
 * extraction read by lib/ngo-rule-extraction.ts when no key is set or the model
 * failed. `fellBackFrom` names the provider that failed, if any.
 */
export async function runRules<T>(site: string, fn: () => Promise<T>, fellBackFrom?: AiProvider | null): Promise<T> {
  const started = Date.now();
  const meta: AiCallMeta = { site, provider: "rules", model: "rules", promptVersion: "rules-v1" };
  try {
    const value = await fn();
    await record({
      meta,
      outcome: "OK",
      faultInjected: false,
      latencyMs: Date.now() - started,
      usage: { tokensIn: null, tokensOut: null },
      errorCode: fellBackFrom ? `FALLBACK_FROM_${fellBackFrom.toUpperCase()}` : null,
    });
    return value;
  } catch (err) {
    await record({ meta, outcome: "ERROR", faultInjected: false, latencyMs: Date.now() - started, usage: { tokensIn: null, tokensOut: null }, errorCode: errorCodeOf(err) });
    throw err;
  }
}

/**
 * For a keyless "mock" stand-in that produces what the model would have (a
 * heuristic score): records it as provider "rules" so it is visible on the
 * telemetry page, and honours fault injection — a stand-in for the model is
 * part of "the AI path", so forcing the AI down must force it down too, or the
 * degraded path could never be observed on a server without a key.
 */
export async function aiStandInGate(site: string): Promise<void> {
  const meta: AiCallMeta = { site, provider: "rules", model: "mock-heuristic", promptVersion: "rules-v1" };
  const fault = await getAiFaultMode();
  if (fault) {
    const kind: AiFailureKind = fault === "timeout" ? "TIMEOUT" : "ERROR";
    await record({ meta, outcome: kind, faultInjected: true, latencyMs: 0, usage: { tokensIn: null, tokensOut: null }, errorCode: `FAULT_INJECTED_${kind}` });
    throw new AiUnavailableError(kind, site, true);
  }
  await record({ meta, outcome: "OK", faultInjected: false, latencyMs: 0, usage: { tokensIn: null, tokensOut: null }, errorCode: "NO_MODEL_KEY" });
}
