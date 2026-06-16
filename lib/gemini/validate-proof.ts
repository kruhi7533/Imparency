import { GoogleGenAI, Type } from "@google/genai";

export interface ValidationResult {
  score: number;
  reasoning: string;
  flags: string[];
  suggestion?: string;
}

export async function validateMilestoneProof(
  milestone: {
    title: string;
    description: string;
    targetAmount: number;
    deadline: Date | string;
    proofTypeRequired: string;
  },
  proofDescription: string,
  fileBuffers: { buffer: Buffer; mimeType: string }[]
): Promise<ValidationResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to Mock validation in development.");
    const containsSuccess = proofDescription.toLowerCase().includes("success") || 
                            proofDescription.toLowerCase().includes("complete") || 
                            proofDescription.toLowerCase().includes("done");
    const score = containsSuccess ? 85 : 45;
    const reasoning = containsSuccess
      ? "Mock Validation: The submitted documentation aligns with the milestone objectives. All required materials are accounted for and match the scope of work."
      : "Mock Validation: The submitted description is brief and doesn't fully justify completion. Additional files/receipts may be needed.";
    const flags = containsSuccess ? [] : ["Incomplete details in proof description"];
    const suggestion = containsSuccess 
      ? undefined 
      : "Please provide detailed photographs or invoice scans proving purchase/implementation.";

    return { score, reasoning, flags, suggestion };
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are an independent auditor for a charitable donation platform in India. 
Your job is to verify that the proof submitted by an NGO genuinely demonstrates 
completion of the milestone they claimed.

MILESTONE DETAILS:
- Title: ${milestone.title}
- Description: ${milestone.description}  
- Target Amount: ₹${milestone.targetAmount}
- Deadline: ${milestone.deadline}
- Proof Type Required: ${milestone.proofTypeRequired}

NGO SUBMITTED DESCRIPTION:
${proofDescription}

Analyze the attached files (photos, receipts, documents) and score the proof 
from 0 to 100 based on:
- Relevance: Do the files actually show what the milestone describes? (40 points)
- Completeness: Is the evidence sufficient to confirm the milestone is done? (30 points)  
- Authenticity: Does the proof appear genuine and not staged or recycled? (20 points)
- Amount Justification: If receipts are present, do amounts align with the milestone budget? (10 points)

Be strict but fair. A score of 70+ means the milestone can be marked complete.
Return ONLY valid JSON matching the required schema. No markdown, no preamble.`;

  const inlineFiles = fileBuffers.map((f) => ({
    inlineData: {
      data: f.buffer.toString("base64"),
      mimeType: f.mimeType,
    },
  }));

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [prompt, ...inlineFiles],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            reasoning: { type: Type.STRING },
            flags: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING } 
            },
            suggestion: { type: Type.STRING }
          },
          required: ["score", "reasoning", "flags"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini API");
    }

    const result = JSON.parse(text);
    return {
      score: typeof result.score === "number" ? result.score : 0,
      reasoning: result.reasoning || "",
      flags: Array.isArray(result.flags) ? result.flags : [],
      suggestion: result.suggestion,
    };
  } catch (err: any) {
    console.error("Gemini proof validation API error:", err);
    throw new Error(`Gemini Validation failed: ${err.message}`);
  }
}
