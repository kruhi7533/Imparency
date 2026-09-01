/**
 * Provider-agnostic shape the investigation loop (run.ts) is written against.
 *
 * Gemini and OpenAI-compatible APIs (Groq, OpenRouter, and anything else that
 * speaks the /chat/completions dialect) disagree about almost everything —
 * message roles, where the system prompt goes, how a tool call and its result
 * are represented, how usage is reported. This interface is the seam: run.ts
 * never sees any of that, it only calls step() / appendToolResults() /
 * appendNudge() and reads back a normalised result.
 */

export interface ProviderToolCall {
  /** Present for OpenAI-compatible providers (ties a result back to its call); absent for Gemini, which doesn't need one. */
  id?: string;
  name: string;
  args: Record<string, any>;
}

export interface ProviderStepResult {
  toolCalls: ProviderToolCall[];
  /** Prose the model returned instead of (or alongside) tool calls. */
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ModelProvider {
  /** For logging/trace only. */
  readonly name: string;

  /** Build the first turn of the conversation, in this provider's native message format. */
  initialHistory(userText: string): any[];

  /**
   * Send `history` to the model and return its move. Also appends the model's
   * own turn (its text and/or tool calls) onto `history` in place — callers
   * never construct that turn themselves, since its shape is provider-specific.
   */
  step(history: any[]): Promise<ProviderStepResult>;

  /**
   * Append the results of this step's tool calls. `responses[i]` is the result
   * for `calls[i]` — order-matched, not name-matched, since a provider may
   * call the same tool twice in one turn with different arguments.
   */
  appendToolResults(history: any[], calls: ProviderToolCall[], responses: any[]): void;

  /** Append a plain-text nudge ("call a tool, or close the investigation"). */
  appendNudge(history: any[], text: string): void;
}
