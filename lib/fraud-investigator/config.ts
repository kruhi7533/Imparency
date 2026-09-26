/**
 * Fraud investigator — tunables.
 *
 * Deliberately smaller than the (deleted) verification caseworker's config: this
 * agent is read-only until its single write at the end, runs to completion in
 * one request, and never waits on an external reply — so there is no lock TTL,
 * heartbeat, or reminder schedule to tune.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Master kill switch. Off by default. */
export const INVESTIGATOR_ENABLED = process.env.INVESTIGATOR_ENABLED === "true";

/**
 * Which model provider actually runs the investigation loop.
 *
 *   "gemini"      — Google's own SDK, structured for Gemini's function-calling
 *                    shape. Default, so nothing changes for anyone who hasn't
 *                    set this.
 *   "groq"        — OpenAI-compatible. Free tier: 1,000 requests/day,
 *                    30 req/min for llama-3.3-70b-versatile as of mid-2026 —
 *                    50x Gemini's free-tier daily cap.
 *   "nvidia"      — OpenAI-compatible. NVIDIA's own hosted inference; the best
 *                    free home for Nemotron (see COMPAT_PRESETS below).
 *   "openrouter"  — OpenAI-compatible. Free tier includes NVIDIA's
 *                    Nemotron 3 Super with explicit tool-use support.
 *   "custom"      — any other OpenAI-compatible endpoint: set
 *                    INVESTIGATOR_BASE_URL / INVESTIGATOR_API_KEY /
 *                    INVESTIGATOR_MODEL directly.
 *
 * Only lib/fraud-investigator is affected. NGO document extraction
 * (lib/gemini/extract-ngo-fields.ts) stays on Gemini — it depends on Gemini's
 * structured-output schema enforcement, which is a separate migration.
 */
export const INVESTIGATOR_PROVIDER = (process.env.INVESTIGATOR_PROVIDER || "gemini").toLowerCase();

export const MODEL = process.env.INVESTIGATOR_GEMINI_MODEL || "gemini-2.5-flash";

interface CompatPreset {
  baseUrl: string;
  /** Provider-specific key env var, checked before the generic INVESTIGATOR_API_KEY. */
  keyEnvVar: string;
  defaultModel: string;
}

const COMPAT_PRESETS: Record<string, CompatPreset> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnvVar: "GROQ_API_KEY",
    // 2x llama-3.3-70b-versatile's free-tier daily token cap (200K vs 100K
    // TPD, per-model — not a shared org bucket, so switching models buys a
    // fresh budget rather than sharing one that's already spent) and supports
    // the same OpenAI-compatible tool-calling shape this provider expects.
    // Verify current numbers at console.groq.com/settings/limits — Groq
    // adjusts free-tier limits per model over time.
    defaultModel: "openai/gpt-oss-120b",
  },
  nvidia: {
    // NVIDIA's own hosted inference (build.nvidia.com), OpenAI-compatible.
    // Worth preferring over OpenRouter for Nemotron specifically: same model
    // family, but a free developer key gets ~40 req/min and thousands of
    // credits instead of OpenRouter's 50 requests/DAY free-tier cap. No credit
    // card. Copy the exact model id from the model's page in the catalogue —
    // NVIDIA's ids are versioned and change between releases.
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnvVar: "NVIDIA_API_KEY",
    // Measured on this agent, 2026-08-13 (one full investigation each):
    //   ultra-550b-a55b  ~78s/step — unusable, 2 steps inside a 150s ceiling
    //   super-120b-a12b  ~39s/step — BEST findings of any model tried, but a
    //                    complete 11-step run takes ~7 MINUTES
    //   3.5-lightning    404, NVIDIA does not host it (OpenRouter does)
    // Super is the quality pick and the right default here; if a run needs to
    // finish inside an HTTP request, use Groq instead — NVIDIA's free tier is
    // credit-rich but slow, which is the opposite trade from Groq.
    defaultModel: "nvidia/nemotron-3-super-120b-a12b",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnvVar: "OPENROUTER_API_KEY",
    // NVIDIA's own release notes for this model name exactly this loop:
    // "calling tools to checking results" for long-running agent work — a
    // more direct match than the earlier default (Nemotron 3 Super). Free,
    // 1M context, 3B active params for speed. Override with INVESTIGATOR_MODEL
    // if OpenRouter's free-model lineup has moved on since.
    defaultModel: "nvidia/nemotron-3.5-lightning:free",
  },
};

export interface CompatConfig {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

/** Resolves the OpenAI-compatible provider's connection details, or null if INVESTIGATOR_PROVIDER isn't one of them. */
export function getCompatConfig(): CompatConfig | null {
  if (INVESTIGATOR_PROVIDER === "custom") {
    return {
      baseUrl: process.env.INVESTIGATOR_BASE_URL || "",
      apiKey: process.env.INVESTIGATOR_API_KEY,
      model: process.env.INVESTIGATOR_MODEL || "",
    };
  }

  const preset = COMPAT_PRESETS[INVESTIGATOR_PROVIDER];
  if (!preset) return null;

  return {
    baseUrl: preset.baseUrl,
    apiKey: process.env[preset.keyEnvVar] || process.env.INVESTIGATOR_API_KEY,
    model: process.env.INVESTIGATOR_MODEL || preset.defaultModel,
  };
}

/**
 * Requests per minute this process will send to whichever provider is active.
 * Enforced in-process (lib/fraud-investigator/rate-limit.ts) BEFORE a call is
 * attempted — a courtesy limit, distinct from withModelRetry's after-the-fact
 * backoff when the provider itself returns 429. Default is conservative
 * (comfortably under Groq's 30 RPM free-tier ceiling); raise it for a
 * provider with more headroom, e.g. via INVESTIGATOR_RPM.
 */
export const INVESTIGATOR_RPM = envInt("INVESTIGATOR_RPM", 20);

/**
 * Tokens-per-minute ceiling for the active provider, or 0 to disable.
 *
 * This, not RPM, is what actually binds a tool-calling loop: each turn resends
 * the entire conversation, so step 8 costs several times what step 1 did.
 * Blowing past it returns a 429 whose Retry-After can exceed a minute.
 *
 * Groq's free-tier ceiling is PER MODEL — do not assume one number. Its 429
 * body reported "Limit 8000" for openai/gpt-oss-120b on 2026-08-16, not the
 * 12,000 this comment used to claim; a value set above the real ceiling makes
 * this throttle decorative, because the provider rejects the call before the
 * window ever fills. Read the limit off `x-ratelimit-limit-tokens` (or the 429
 * body) for the model you are actually running and set INVESTIGATOR_TPM below
 * it, leaving room for the headroom reserve in rate-limit.ts.
 *
 * Default 0 (off) because it only matters where the provider enforces a token
 * budget — which means a deployment that forgets INVESTIGATOR_TPM runs with no
 * token throttle at all.
 */
export const INVESTIGATOR_TPM = envInt("INVESTIGATOR_TPM", 0);

/**
 * Steps before the run is forced to close with whatever it has.
 *
 * 14, not 8: there are 10 read tools, and a model that legitimately wants most
 * of them still needs turns left to call file_finding and close_investigation
 * afterwards. At 8, Nemotron gathered every piece of evidence including the
 * donor overlap and was then cut off before it could file anything — the
 * budget was truncating good investigations rather than catching runaway ones.
 * This is a safety ceiling, not a target: a model that finishes in 5 still
 * finishes in 5 and costs nothing extra.
 */
export const STEP_BUDGET = envInt("INVESTIGATOR_STEP_BUDGET", 14);

/** Per-run spend ceiling, in integer paise. */
export const COST_CAP_PAISE = envInt("INVESTIGATOR_COST_CAP_PAISE", 800);

/**
 * Wall clock for one run — this is synchronous, so keep it well under a request
 * timeout. 150s because free-tier endpoints are frequently queued behind paid
 * traffic: measured ~9s per step on OpenRouter's free tier, so a 10-step
 * investigation legitimately needs ~90s+ and the previous 90s ceiling was
 * cutting off runs that were about to conclude. Groq's free tier is far
 * faster and rarely comes near this.
 */
export const WALL_CLOCK_MS = envInt("INVESTIGATOR_WALL_CLOCK_MS", 150_000);

/**
 * Wall clock for runs nobody is waiting on — the automatic path in trigger.ts,
 * which is fire-and-forget from inside createFraudAlert().
 *
 * Separate from WALL_CLOCK_MS because the two have different masters: that one
 * is bounded by an admin holding an open HTTP request, this one only by not
 * wanting a runaway. On a free tier the throttle, not the model, sets the pace
 * — measured 2026-08-26, seven steps took 190s against an 8,000 TPM ceiling,
 * almost all of it waiting for the token window to roll. An investigation that
 * stops early is not a cheap investigation; it is a wasted one, because the
 * tokens were spent and no conclusion was reached.
 */
export const BACKGROUND_WALL_CLOCK_MS = envInt("INVESTIGATOR_BACKGROUND_WALL_CLOCK_MS", 600_000);

export const MODEL_RETRY_DELAYS_MS = [1_000, 3_000];

export const NO_PROGRESS_LIMIT = 2;

/**
 * Cost-estimate pricing, in paise per 1M tokens. Defaults assume Gemini's paid
 * rate ONLY when INVESTIGATOR_PROVIDER is "gemini" — Groq and OpenRouter's
 * free-tier models (including the Nemotron default) genuinely cost 0, and
 * showing a fabricated non-zero figure for a free model is actively
 * misleading, not just imprecise. Set INVESTIGATOR_PRICE_IN/OUT explicitly if
 * you switch to a paid Groq/OpenRouter model.
 */
const DEFAULT_PRICE_IN = INVESTIGATOR_PROVIDER === "gemini" ? 2_500 : 0;
const DEFAULT_PRICE_OUT = INVESTIGATOR_PROVIDER === "gemini" ? 21_000 : 0;

export const PRICE_PAISE_PER_MTOK_IN = envInt("INVESTIGATOR_PRICE_IN", DEFAULT_PRICE_IN);
export const PRICE_PAISE_PER_MTOK_OUT = envInt("INVESTIGATOR_PRICE_OUT", DEFAULT_PRICE_OUT);
