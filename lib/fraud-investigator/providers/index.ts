import { INVESTIGATOR_PROVIDER, getCompatConfig } from "../config";
import { createGeminiProvider } from "./gemini-provider";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider";
import type { ModelProvider } from "./types";

export type ProviderResult = { provider: ModelProvider } | { error: string };

/**
 * Builds whichever provider INVESTIGATOR_PROVIDER selects. Returns an error
 * string rather than throwing — the caller (run.ts) already has a pattern for
 * "this run cannot start" (FAILED, visible, no silent stop) and this reuses
 * it instead of adding a second failure shape.
 */
export function createProvider(): ProviderResult {
  if (INVESTIGATOR_PROVIDER === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { error: "GEMINI_API_KEY is not configured." };
    return { provider: createGeminiProvider(apiKey) };
  }

  const compat = getCompatConfig();
  if (!compat) {
    return {
      error: `Unknown INVESTIGATOR_PROVIDER "${INVESTIGATOR_PROVIDER}". Use "gemini", "groq", "nvidia", "openrouter", or "custom".`,
    };
  }
  if (!compat.apiKey) {
    return { error: `No API key configured for INVESTIGATOR_PROVIDER="${INVESTIGATOR_PROVIDER}".` };
  }
  if (!compat.model) {
    return { error: `No model configured for INVESTIGATOR_PROVIDER="${INVESTIGATOR_PROVIDER}".` };
  }
  if (!compat.baseUrl) {
    return { error: `No base URL configured for INVESTIGATOR_PROVIDER="${INVESTIGATOR_PROVIDER}".` };
  }

  return {
    provider: createOpenAICompatibleProvider(compat.baseUrl, compat.apiKey, compat.model, INVESTIGATOR_PROVIDER),
  };
}
