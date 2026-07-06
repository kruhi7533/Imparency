import { GoogleGenAI } from "@google/genai";

/**
 * Donor authenticity/risk insight agent — admin-only.
 *
 * Same philosophy as ngo-trust-insight.ts: reason over the real signals we
 * already record (PAN verification state, name-match, donation velocity,
 * category-downgrade history, open fraud alerts) and produce one plain-English
 * read for the admin, instead of a raw score that could be misread as an
 * accusation. Grounded strictly in the input — never invents facts.
 *
 * Always degrades gracefully: missing API key or any error → a factual
 * fallback summary, so the admin panel never breaks.
 */

export interface DonorRiskSignals {
  donorName: string;
  panStatus: string; // UNVERIFIED | VERIFIED | FAILED | PROVIDER_ERROR
  panVerifiedVia: string | null; // MOCK | SUREPASS | MANUAL_ADMIN | null
  panNameMatch: boolean | null; // null = no name returned by provider
  donorCategory: string | null;
  categoryDowngradedFromFcra: boolean; // true if DonorEvent shows a post-block downgrade
  totalDonations: number;
  successfulDonations: number;
  failedDonations: number;
  donationsLast24h: number;
  openFraudAlerts: number;
  highSeverityFraudAlerts: number;
  accountAgeDays: number;
}

function fallbackSummary(s: DonorRiskSignals): string {
  const parts: string[] = [];
  parts.push(`PAN ${s.panStatus}${s.panVerifiedVia === "MOCK" ? " (mock mode — not actually checked)" : ""}.`);
  if (s.panNameMatch === false) parts.push("Name does not match PAN records.");
  if (s.categoryDowngradedFromFcra) parts.push("Declaration changed after being FCRA-blocked.");
  if (s.openFraudAlerts > 0) parts.push(`${s.openFraudAlerts} open fraud alert(s).`);
  if (s.donationsLast24h > 5) parts.push(`${s.donationsLast24h} donations in the last 24h.`);
  return parts.length ? parts.join(" ") : "No risk signals recorded.";
}

export async function generateDonorRiskInsight(signals: DonorRiskSignals): Promise<string> {
  const fallback = fallbackSummary(signals);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY not defined. Donor risk insight falling back to plain summary.");
    return fallback;
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a fraud-and-authenticity analyst for an Indian charitable-donation platform. Write a short
internal note for an ADMIN summarising whether a donor's activity looks genuine, based ONLY on the verified data
below. Most donors are honest — do not imply wrongdoing unless the data actually supports it.

Donor: ${signals.donorName}

VERIFIED DATA (the only facts you may use — do not invent anything beyond this):
- PAN status: ${signals.panStatus}${signals.panVerifiedVia ? ` (verified via ${signals.panVerifiedVia})` : ""}
- PAN name match: ${signals.panNameMatch === null ? "no registered name returned" : signals.panNameMatch ? "matches" : "DOES NOT MATCH"}
- Declared donor category: ${signals.donorCategory ?? "not declared"}
- Changed declaration after being blocked by the FCRA gate: ${signals.categoryDowngradedFromFcra ? "YES" : "No"}
- Total donations: ${signals.totalDonations} (${signals.successfulDonations} successful, ${signals.failedDonations} failed)
- Donations in the last 24 hours: ${signals.donationsLast24h}
- Open fraud/risk alerts: ${signals.openFraudAlerts} (${signals.highSeverityFraudAlerts} high severity)
- Account age: ${signals.accountAgeDays} days

Write ONE short paragraph (35-60 words) that:
- Gives a clear overall read: looks genuine / worth a second look / needs review — stated plainly.
- Cites the 1-3 most relevant facts above to justify that read.
- If PAN was verified in MOCK mode, mention that it hasn't actually been checked against real records yet.
- Never accuses the donor of fraud outright — describe what the data shows, let the admin judge.
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
    console.error("Donor risk insight agent error:", err);
    return fallback;
  }
}
