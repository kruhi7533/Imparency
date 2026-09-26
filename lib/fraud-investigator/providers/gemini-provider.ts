import { GoogleGenAI } from "@google/genai";
import { MODEL } from "../config";
import { SYSTEM_INSTRUCTION } from "../prompts";
import { DECLARATIONS } from "../declarations";
import { withModelRetry } from "../retry";
import type { ModelProvider, ProviderStepResult, ProviderToolCall } from "./types";

/** The original implementation, unchanged in behaviour — just moved behind the ModelProvider seam. */
export function createGeminiProvider(apiKey: string): ModelProvider {
  const ai = new GoogleGenAI({ apiKey });

  return {
    name: "gemini",

    initialHistory(userText: string): any[] {
      return [{ role: "user", parts: [{ text: userText }] }];
    },

    async step(history: any[]): Promise<ProviderStepResult> {
      const response = await withModelRetry(() =>
        ai.models.generateContent({
          model: MODEL,
          contents: history,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: 0.2,
            tools: [{ functionDeclarations: DECLARATIONS as any }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" as any } },
          },
        })
      );

      const usage = response.usageMetadata;
      const tokensIn = usage?.promptTokenCount ?? 0;
      const tokensOut = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);

      const toolCalls: ProviderToolCall[] = (response.functionCalls ?? [])
        .filter((c): c is typeof c & { name: string } => !!c.name)
        .map((c) => ({ name: c.name, args: c.args ?? {} }));

      // The model's own turn must be appended before the next call sees it —
      // Gemini requires the SAME shape (functionCall parts) it emitted.
      history.push(
        toolCalls.length > 0
          ? { role: "model", parts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) }
          : { role: "model", parts: [{ text: response.text ?? "" }] }
      );

      return { toolCalls, text: response.text ?? "", tokensIn, tokensOut };
    },

    appendToolResults(history: any[], calls: ProviderToolCall[], responses: any[]): void {
      history.push({
        role: "user",
        parts: calls.map((c, i) => ({ functionResponse: { name: c.name, response: responses[i] } })),
      });
    },

    appendNudge(history: any[], text: string): void {
      history.push({ role: "user", parts: [{ text }] });
    },
  };
}
