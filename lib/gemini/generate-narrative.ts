import { GoogleGenAI } from "@google/genai";

export async function generateImpactNarrative(
  donor: { name: string },
  donation: { amount: number },
  project: { title: string; raisedAmount: number },
  ngo: { orgName: string },
  milestone: { title: string; description: string },
  proofDescription: string,
  nextMilestoneTitle?: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  const percentage = project.raisedAmount > 0
    ? Math.round((Number(donation.amount) / Number(project.raisedAmount)) * 100)
    : 0;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to Mock narrative in development.");
    const nextText = nextMilestoneTitle 
      ? `The next milestone "${nextMilestoneTitle}" is already underway.` 
      : "The project is now complete!";
    return `Hi ${donor.name}, through your contribution of ₹${donation.amount.toLocaleString()} (representing ${percentage}% of the total funds raised), ${ngo.orgName} successfully completed the milestone "${milestone.title}" for the campaign "${project.title}". Your funding supported: ${milestone.description}. ${nextText}`;
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a heartfelt storyteller for ImpactBridge, a donation transparency platform.
Write a short, warm, personal impact update for a donor.

DONOR CONTEXT:
- Donor Name: ${donor.name}
- Their Donation Amount: ₹${donation.amount}
- Total Project Donation Pool: ₹${project.raisedAmount}
- Their Contribution Percentage: ${percentage}%

MILESTONE THAT WAS JUST COMPLETED:
- Project: ${project.title}
- NGO Name: ${ngo.orgName}
- Milestone: ${milestone.title}
- Milestone Description: ${milestone.description}
- NGO's Own Description of Completion: ${proofDescription}

Write 3-4 sentences maximum. Be specific about what their money helped achieve.
Reference their actual donation amount. Use warm, human language — not corporate.
Do not use phrases like "your generous donation". Do not use exclamation marks excessively.
Make the donor feel like they can see the real-world impact of their specific contribution.
End with one sentence about the next milestone coming up: ${nextMilestoneTitle || "the project is now complete!"} (or 
"the project is now complete!" if this was the final milestone).

Return ONLY the narrative text. No JSON, no formatting, no preamble.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return response.text?.trim() || "";
  } catch (err: any) {
    console.error("Gemini narrative generation API error:", err);
    throw new Error(`Gemini Narrative failed: ${err.message}`);
  }
}
