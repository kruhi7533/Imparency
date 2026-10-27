/**
 * Claude as an optional AI provider. Server-only.
 *
 * Used first when ANTHROPIC_API_KEY is set; every caller keeps its existing
 * Gemini path and its rule-based fallback, so an unset key, a refusal or an
 * outage degrades to the next provider rather than to an error page.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { callAi } from "@/lib/ai/telemetry";

export const CLAUDE_MODEL = "claude-opus-5-5";

export function isClaudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export class ClaudeCallError extends Error {
  constructor(
    public readonly code: "NOT_CONFIGURED" | "REFUSED" | "NO_OUTPUT",
    message: string
  ) {
    super(message);
    this.name = "ClaudeCallError";
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!isClaudeConfigured()) throw new ClaudeCallError("NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set.");
  // An org-level key (not scoped to one workspace) must name the workspace on
  // every request; ANTHROPIC_WORKSPACE_ID supplies it when set.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  client ??= new Anthropic({
    maxRetries: 1,
    timeout: 90_000,
    ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
  });
  return client;
}

/** A PDF or image as a content block, for document-reading calls. */
export function fileBlock(buffer: Buffer, mimeType: string): Anthropic.Beta.BetaContentBlockParam {
  const data = buffer.toString("base64");
  if (mimeType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  const media_type = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)
    ? mimeType
    : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  return { type: "image", source: { type: "base64", media_type, data } };
}

/**
 * One structured-output call. Returns the schema-validated object or throws
 * ClaudeCallError / an SDK error — callers catch and fall back.
 */
export async function claudeStructured<S extends z.ZodType>(opts: {
  schema: S;
  content: Anthropic.Beta.BetaContentBlockParam[];
  system?: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** Telemetry call-site key (AI-009). Optional; defaults to "claude". */
  site?: string;
  promptVersion?: string;
}): Promise<z.infer<S>> {
  const anthropic = getClient(); // NOT_CONFIGURED throws before any telemetry row
  // AI-009/010: telemetry, fault injection and a time budget just above the
  // client's own 90s timeout.
  const response = await callAi(
    { site: opts.site ?? "claude", provider: "anthropic", model: CLAUDE_MODEL, promptVersion: opts.promptVersion ?? "v1", timeoutMs: 95_000 },
    (signal) => anthropic.beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    // A policy decline is re-run on a fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(opts.system ? { system: opts.system } : {}),
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.content }],
  }, { signal })
  );

  if (response.stop_reason === "refusal") {
    throw new ClaudeCallError("REFUSED", "The model declined this request.");
  }
  if (response.parsed_output == null) {
    throw new ClaudeCallError("NO_OUTPUT", `No structured output (stop_reason: ${response.stop_reason}).`);
  }
  return response.parsed_output as z.infer<S>;
}
