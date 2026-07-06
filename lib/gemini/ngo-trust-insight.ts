import { GoogleGenAI } from "@google/genai";

/**
 * Trust Insight agent — admin-only.
 *
 * Turns the signals we already compute (health score, compliance score,
 * fraud alerts, overdue milestones) into one short, human-readable paragraph
 * instead of a raw ranking number. Deliberately narrative, not a formula:
 * a paragraph can't be gamed the way a score can, and it naturally explains
 * "too new to assess" the same non-punitive way the health score already does.
 *
 * Grounded strictly in the numbers passed in — the prompt forbids inventing
 * facts not present in the input. Always degrades gracefully: on missing API
 * key or any error, returns a plain-data fallback summary so the admin panel
 * never breaks.
 */

export interface NgoTrustSignals {
  orgName: string;
  healthScore: number | null; // null = not enough data yet (existing convention)
  complianceScore: number; // 0-100, derived
  fcraBadge: string;
  openFraudAlerts: number;
  highSeverityFraudAlerts: number;
  overdueMilestones: number;
  totalMilestones: number;
  completedMilestones: number;
  raisedAmount: number;
  verifiedMilestoneAmount: number;
}

function fallbackSummary(s: NgoTrustSignals): string {
  const parts: string[] = [];
  parts.push(s.healthScore === null ? "Not enough activity yet to assess reliability." : `Health score ${s.healthScore.toFixed(0)}/100.`);
  parts.push(`Compliance ${s.complianceScore}/100.`);
  if (s.overdueMilestones > 0) parts.push(`${s.overdueMilestones} milestone(s) overdue.`);
  if (s.openFraudAlerts > 0) parts.push(`${s.openFraudAlerts} open fraud alert(s).`);
  return parts.join(" ");
}

export async function generateNgoTrustInsight(signals: NgoTrustSignals): Promise<string> {
  const fallback = fallbackSummary(signals);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY not defined. Trust insight falling back to plain summary.");
    return fallback;
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a trust-and-risk analyst for an Indian charitable-donation platform. You are writing a
short internal note for an ADMIN (not the NGO, not a donor) summarising how trustworthy and transparent an NGO
has been, based ONLY on the verified data below.

NGO: ${signals.orgName}

VERIFIED DATA (the only facts you may use — do not invent anything beyond this):
- Health score: ${signals.healthScore === null ? "not enough data yet (new NGO)" : `${signals.healthScore.toFixed(0)}/100`}
- Compliance score (documents verified): ${signals.complianceScore}/100
- FCRA status: ${signals.fcraBadge}
- Open fraud/risk alerts: ${signals.openFraudAlerts} (of which ${signals.highSeverityFraudAlerts} are high severity)
- Milestones: ${signals.completedMilestones} of ${signals.totalMilestones} completed
- Currently overdue milestones (deadline passed, no proof submitted): ${signals.overdueMilestones}
- Funds raised: ₹${signals.raisedAmount.toLocaleString("en-IN")}
- Funds against admin-verified milestones: ₹${signals.verifiedMilestoneAmount.toLocaleString("en-IN")}

Write ONE short paragraph (40-70 words) that:
- Gives a clear overall read: reliable / mixed / needs attention — stated plainly, not hedged.
- Cites the 2-3 most relevant numbers above to justify that read.
- If health score is "not enough data yet", say the NGO is too new to assess rather than implying anything negative.
- Is factual and calm — no exaggeration, no accusations beyond what the numbers show.
- Output PLAIN TEXT only, no markdown, no bullet points, no quotes around it.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [prompt],
    });

    const text = response.text?.trim();
    if (!text) return fallback;
    return text;
  } catch (err: any) {
    console.error("Trust insight agent error:", err);
    return fallback;
  }
}
