import { GoogleGenAI } from "@google/genai";

/**
 * Nudge-draft agent — admin-only.
 *
 * Drafts a warm, specific reminder for a Quiet NGO (no impact update in 30+
 * days) or an NGO with overdue milestones. AI drafts, admin reviews/edits
 * before actually sending — same human-in-the-loop pattern as every other
 * agent on this platform. Never sends anything itself.
 */

export interface NudgeContext {
  orgName: string;
  reason: "QUIET" | "OVERDUE_MILESTONE";
  activeProjectTitles: string[];
  overdueMilestones: { projectTitle: string; milestoneTitle: string; deadline: Date }[];
}

function fallbackDraft(ctx: NudgeContext): string {
  if (ctx.reason === "OVERDUE_MILESTONE" && ctx.overdueMilestones.length > 0) {
    const list = ctx.overdueMilestones.map((m) => `- "${m.milestoneTitle}" (${m.projectTitle})`).join("\n");
    return `Hi ${ctx.orgName} team,\n\nA quick reminder that the following milestone deadline(s) have passed without proof being submitted:\n\n${list}\n\nCould you share an update or submit proof when you get a chance? Donors are keen to see progress.\n\nThanks!`;
  }
  return `Hi ${ctx.orgName} team,\n\nIt's been a while since donors last heard an update on your active project(s). Even a short note or photo would go a long way in keeping supporters engaged.\n\nThanks for the work you're doing!`;
}

export async function draftNudgeMessage(ctx: NudgeContext): Promise<string> {
  const fallback = fallbackDraft(ctx);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY not defined. Nudge draft falling back to template.");
    return fallback;
  }

  const ai = new GoogleGenAI({ apiKey });

  const overdueList = ctx.overdueMilestones.length
    ? ctx.overdueMilestones
        .map((m) => `- "${m.milestoneTitle}" on project "${m.projectTitle}" (deadline ${m.deadline.toLocaleDateString("en-IN")})`)
        .join("\n")
    : "None specifically overdue.";

  const prompt = `You are a friendly partnerships coordinator for an Indian charitable-donation platform. Draft a
short reminder message for an NGO partner. This is a NUDGE, not a warning — assume good faith, they're likely just
busy.

NGO: ${ctx.orgName}
Reason for the nudge: ${ctx.reason === "OVERDUE_MILESTONE" ? "one or more milestone deadlines passed with no proof submitted" : "no donor-facing update posted in over 30 days"}
Active projects: ${ctx.activeProjectTitles.join(", ") || "none listed"}
Overdue milestones:
${overdueList}

Write a short message (50-90 words) that:
- Is warm, specific, and encouraging — never accusatory.
- Mentions the actual project/milestone names above if relevant.
- Makes clear WHY it matters: donors are waiting to see progress.
- Ends with a simple, low-friction ask (share an update / submit proof).
- Do NOT include a greeting header beyond "Hi [org] team," and do NOT include a sign-off — the admin will add that when they send it.
- Output PLAIN TEXT only, no markdown, no quotes around it.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [prompt],
    });

    const text = response.text?.trim();
    if (!text) return fallback;
    return text;
  } catch (err: any) {
    console.error("Nudge draft agent error:", err);
    return fallback;
  }
}
