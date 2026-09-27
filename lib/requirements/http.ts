import { NextResponse } from "next/server";
import { RequirementWorkflowError } from "./errors";

/** Maps workflow errors to their HTTP status; anything else is a logged 500. */
export function errorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof RequirementWorkflowError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // LLM capacity outage (see llm.service LlmUnavailableError): temporary, retryable.
  if ((err as any)?.name === "LlmUnavailableError") {
    return NextResponse.json({ error: (err as Error).message, retryable: true }, { status: 503 });
  }
  console.error(`[${context}]`, err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** Parses a JSON body, treating an empty/invalid body as {}. */
export async function readJson(request: Request): Promise<Record<string, any>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}
