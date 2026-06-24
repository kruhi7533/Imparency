import { GoogleGenAI } from "@google/genai";

/**
 * Rejection-guidance agent.
 *
 * Turns a terse admin rejection note (plus any AI verification / pre-screening
 * flags) into a clear, warm, specific and actionable message for the NGO, so
 * they understand exactly what to fix and resubmit.
 *
 * Returns plain text meant to sit inside the existing rejection email/dashboard
 * note — NO greeting and NO sign-off (the email template adds those).
 * Always degrades gracefully: on missing API key or any error it returns the
 * original admin note unchanged, so rejection never breaks.
 */

interface RejectionContext {
  orgName: string;
  adminNote: string;
  aiSummary?: string | null;
  flags?: { severity?: string; issue?: string }[] | null;
}

function collectFlagLines(flags?: { severity?: string; issue?: string }[] | null): string {
  if (!Array.isArray(flags) || flags.length === 0) return "None recorded.";
  return flags
    .map((f) => `- [${f.severity || "INFO"}] ${f.issue || ""}`.trim())
    .filter(Boolean)
    .join("\n");
}

export async function composeRejectionGuidance(ctx: RejectionContext): Promise<string> {
  const fallback = ctx.adminNote;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY not defined. Rejection guidance falling back to raw admin note.");
    return fallback;
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a supportive compliance assistant for an Indian charitable-donation platform.
An admin has REJECTED an NGO's verification application. Rewrite the internal rejection reason into a clear,
respectful, and ENCOURAGING message addressed directly to the NGO, so they know exactly what went wrong and
how to fix it before resubmitting.

NGO name: ${ctx.orgName}

ADMIN'S REJECTION NOTE (the authoritative reason — do not contradict it):
"${ctx.adminNote}"

AI DOCUMENT-CHECK SUMMARY (context, may be empty):
${ctx.aiSummary || "Not available."}

SPECIFIC FLAGS RAISED (context, may be empty):
${collectFlagLines(ctx.flags)}

Write the message following ALL of these rules:
- Address the NGO in second person ("your application", "please re-upload...").
- Be warm and non-accusatory — assume honest mistakes, never imply they are fraudulent.
- Be SPECIFIC and ACTIONABLE: list the exact items to correct as short bullet points (use "- " bullets).
- Tie each fix to the actual reason/flags above. Do not invent issues that were not mentioned.
- End with one short encouraging line inviting them to correct and resubmit.
- Keep it concise (roughly 90-150 words).
- Do NOT include a greeting ("Hi", "Dear...") or a sign-off ("Regards", a team name) — those are added separately.
- Output PLAIN TEXT only. No markdown headers, no JSON, no quotes around the whole message.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [prompt],
    });

    const text = response.text?.trim();
    if (!text) return fallback;
    return text;
  } catch (err: any) {
    console.error("Rejection guidance agent error:", err);
    return fallback;
  }
}
