import { SYSTEM_INSTRUCTION } from "../prompts";
import { DECLARATIONS } from "../declarations";
import { withModelRetry } from "../retry";
import type { ModelProvider, ProviderStepResult, ProviderToolCall } from "./types";

/**
 * Any provider that speaks the OpenAI /chat/completions dialect — Groq,
 * OpenRouter, NVIDIA NIM, or a self-hosted vLLM/Ollama endpoint. This is what
 * makes Nemotron-via-OpenRouter or Llama-via-Groq possible without a second
 * SDK: they're all the same wire format, just a different base URL, key, and
 * model string.
 */

/**
 * Gemini's Type.OBJECT/Type.STRING/... enum values are just the strings
 * "OBJECT", "STRING", etc — lowercase them for standard JSON Schema, which is
 * all a well-formed function tool's `parameters` needs to be. `nullable` has
 * no OpenAI-side equivalent in tool parameters; dropping it is safe because
 * every field that carries it is also absent from `required`, so the model
 * can simply omit it rather than needing to pass an explicit null.
 */
/** Exported for tests — this is the one piece of pure translation logic here. */
export function toJsonSchema(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, any> = {};
  if (schema.type) out.type = String(schema.type).toLowerCase();
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.items) out.items = toJsonSchema(schema.items);
  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = toJsonSchema(value);
    }
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  return out;
}

export const TOOLS = DECLARATIONS.map((d) => ({
  type: "function",
  function: { name: d.name, description: d.description, parameters: toJsonSchema(d.parameters) },
}));

export function createOpenAICompatibleProvider(
  baseUrl: string,
  apiKey: string,
  model: string,
  providerLabel: string
): ModelProvider {
  async function chatCompletion(messages: any[]): Promise<any> {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attributes usage to an app if these are present; harmless
        // no-ops for Groq and other providers that ignore unknown headers.
        "HTTP-Referer": "https://impactbridge.local",
        "X-Title": "ImpactBridge Fraud Investigator",
      },
      body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2 }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err: any = new Error(`${providerLabel} ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
      err.status = res.status;
      // Surfaced as a plain number so retry.ts doesn't need to know this is an
      // HTTP header — it just asks "how long did the server say to wait".
      const retryAfter = res.headers.get("retry-after");
      if (retryAfter) {
        const seconds = Number.parseFloat(retryAfter);
        if (Number.isFinite(seconds) && seconds > 0) err.retryAfterMs = Math.ceil(seconds * 1000) + 1000;
      }
      throw err;
    }

    return res.json();
  }

  return {
    name: providerLabel,

    initialHistory(userText: string): any[] {
      return [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: userText },
      ];
    },

    async step(history: any[]): Promise<ProviderStepResult> {
      const data = await withModelRetry(() => chatCompletion(history));
      const message = data?.choices?.[0]?.message ?? {};

      const toolCalls: ProviderToolCall[] = Array.isArray(message.tool_calls)
        ? message.tool_calls
            .map((tc: any) => {
              let args: Record<string, any> = {};
              try {
                args = JSON.parse(tc?.function?.arguments || "{}");
              } catch {
                args = {};
              }
              return { id: tc?.id, name: tc?.function?.name, args };
            })
            .filter((c: ProviderToolCall) => !!c.name)
        : [];

      // The assistant's own turn, in the exact shape the API expects back —
      // OpenAI-style providers require the raw tool_calls array verbatim, not
      // a reconstruction, or the follow-up tool messages won't line up.
      history.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        ...(Array.isArray(message.tool_calls) && message.tool_calls.length > 0
          ? { tool_calls: message.tool_calls }
          : {}),
      });

      return {
        toolCalls,
        text: typeof message.content === "string" ? message.content : "",
        tokensIn: data?.usage?.prompt_tokens ?? 0,
        tokensOut: data?.usage?.completion_tokens ?? 0,
      };
    },

    appendToolResults(history: any[], calls: ProviderToolCall[], responses: any[]): void {
      calls.forEach((call, i) => {
        history.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(responses[i] ?? {}),
        });
      });
    },

    appendNudge(history: any[], text: string): void {
      history.push({ role: "user", content: text });
    },
  };
}
