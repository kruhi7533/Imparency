import { GoogleGenAI, Type } from "@google/genai";

export interface ValidationResult {
  score: number;
  reasoning: string;
  flags: string[];
  suggestion?: string;
  tocAlignmentScore?: number;
  tocReasoning?: string;
  tocStrengths?: string[];
  tocGaps?: string[];
}

export async function validateMilestoneProof(
  milestone: {
    title: string;
    description: string;
    targetAmount: number;
    deadline: Date | string;
    proofTypeRequired: string;
  },
  project: {
    problemStatement: string;
    expectedOutcome: string;
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
      
    const tocAlignmentScore = containsSuccess ? 80 : 40;
    const tocReasoning = "Mock Validation: Evaluating alignment against long-term project outcome.";
    const tocStrengths = containsSuccess ? ["Addresses root problem"] : [];
    const tocGaps = containsSuccess ? [] : ["Missing long-term outcome data"];

    return { score, reasoning, flags, suggestion, tocAlignmentScore, tocReasoning, tocStrengths, tocGaps };
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are an independent auditor for a charitable donation platform in India. 
Your job is to verify that the proof submitted by an NGO genuinely demonstrates 
completion of the milestone they claimed, AND to evaluate if this proof aligns with the overarching project's Theory of Change (long-term impact).

OVERARCHING PROJECT (Theory of Change):
- Problem Statement: ${project.problemStatement}
- Expected Outcome: ${project.expectedOutcome}

IMMEDIATE MILESTONE DETAILS:
- Title: ${milestone.title}
- Description: ${milestone.description}  
- Target Amount: ₹${milestone.targetAmount}
- Deadline: ${milestone.deadline}
- Proof Type Required: ${milestone.proofTypeRequired}

NGO SUBMITTED DESCRIPTION:
${proofDescription}

TASK 1: MILESTONE VALIDATION
Analyze the attached files (photos, receipts, documents) and score the proof from 0 to 100 based on whether it satisfies the immediate milestone:
- Relevance: Do the files actually show what the milestone describes? (40 points)
- Completeness: Is the evidence sufficient to confirm the milestone is done? (30 points)  
- Authenticity: Does the proof appear genuine and not staged or recycled? (20 points)
- Amount Justification: If receipts are present, do amounts align with the milestone budget? (10 points)

TASK 2: THEORY OF CHANGE (IMPACT) ALIGNMENT
Evaluate if the observed outcomes in the proof contribute toward the Project's overarching Expected Outcome:
- Give a Theory of Change (ToC) alignment score from 0-100. (E.g., just training someone doesn't necessarily mean they got a job).
- Explain your ToC reasoning.
- List specific strengths (evidence of real impact).
- List specific gaps (missing evidence of long-term outcomes).

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
            suggestion: { type: Type.STRING },
            tocAlignmentScore: { type: Type.INTEGER },
            tocReasoning: { type: Type.STRING },
            tocStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            tocGaps: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["score", "reasoning", "flags", "tocAlignmentScore", "tocReasoning", "tocStrengths", "tocGaps"]
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
      tocAlignmentScore: typeof result.tocAlignmentScore === "number" ? result.tocAlignmentScore : null,
      tocReasoning: result.tocReasoning || null,
      tocStrengths: Array.isArray(result.tocStrengths) ? result.tocStrengths : [],
      tocGaps: Array.isArray(result.tocGaps) ? result.tocGaps : [],
    };
  } catch (err: any) {
    console.error("Gemini proof validation API error:", err);
    throw new Error(`Gemini Validation failed: ${err.message}`);
  }
}
