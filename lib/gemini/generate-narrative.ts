import { GoogleGenAI, Type, Schema } from "@google/genai";
import { SDG_MASTER, IRIS_MASTER } from "../impact-metrics";

export async function generateImpactNarrative(
  donor: { name: string },
  donation: { amount: number },
  project: { title: string; raisedAmount: number },
  ngo: { orgName: string },
  milestone: { title: string; description: string },
  proofDescription: string,
  nextMilestoneTitle?: string
): Promise<{ narrative: string; sdgTags: string[]; irisMetrics: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;

  const percentage = project.raisedAmount > 0
    ? Math.round((Number(donation.amount) / Number(project.raisedAmount)) * 100)
    : 0;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to Mock narrative in development.");
    const nextText = nextMilestoneTitle 
      ? `The next milestone "${nextMilestoneTitle}" is already underway.` 
      : "The project is now complete!";
    return {
      narrative: `Hi ${donor.name}, through your contribution of ₹${donation.amount.toLocaleString()} (representing ${percentage}% of the total funds raised), ${ngo.orgName} successfully completed the milestone "${milestone.title}" for the campaign "${project.title}". Your funding supported: ${milestone.description}. ${nextText}`,
      sdgTags: ["SDG3", "SDG4"],
      irisMetrics: ["PI1000", "PI2822"]
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a heartfelt storyteller and impact analyst for ImpactBridge, a donation transparency platform.
Write a short, warm, personal impact update for a donor, AND map the outcome to standard impact frameworks.

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

1. NARRATIVE:
Write 3-4 sentences maximum. Be specific about what their money helped achieve. Reference their actual donation amount. Use warm, human language. End with one sentence about the next milestone coming up: ${nextMilestoneTitle || "the project is now complete!"}.

2. SDG TAGS:
Select the most appropriate UN Sustainable Development Goals (SDGs) for this milestone.
Choose ONLY from these IDs: ${Object.keys(SDG_MASTER).join(", ")}.

3. IRIS+ METRICS:
Select the most appropriate GIIN IRIS+ metrics.
Choose ONLY from these IDs: ${Object.keys(IRIS_MASTER).join(", ")}.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            narrative: { type: Type.STRING },
            sdgTags: { type: Type.ARRAY, items: { type: Type.STRING } },
            irisMetrics: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["narrative", "sdgTags", "irisMetrics"]
        }
      }
    });

    const data = JSON.parse(response.text || "{}");
    return {
      narrative: data.narrative || "",
      sdgTags: data.sdgTags || [],
      irisMetrics: data.irisMetrics || []
    };
  } catch (err: any) {
    console.error("Gemini narrative generation API error:", err);
    throw new Error(`Gemini Narrative failed: ${err.message}`);
  }
}
