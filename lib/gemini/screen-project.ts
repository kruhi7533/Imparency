import { GoogleGenAI, Type } from "@google/genai";

export interface ProjectScreeningResult {
  score: number; // 0-100 overall quality/trust score
  recommendation: "APPROVE" | "REVIEW" | "REJECT";
  reasoning: string;
  flags: string[];
}

interface ProjectInput {
  title: string;
  description: string;
  causeCategory: string;
  targetAmount: number;
  location: string;
  problemStatement: string | null;
  expectedOutcome: string | null;
}

interface MilestoneInput {
  title: string;
  description: string;
  targetAmount: number;
  deadline: Date | string;
}

function recommendationFromScore(score: number): "APPROVE" | "REVIEW" | "REJECT" {
  if (score >= 75) return "APPROVE";
  if (score >= 45) return "REVIEW";
  return "REJECT";
}

export async function screenProject(
  project: ProjectInput,
  milestones: MilestoneInput[]
): Promise<ProjectScreeningResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to Mock project screening in development.");
    const flags: string[] = [];
    if (!project.problemStatement) flags.push("No problem statement provided");
    if (!project.expectedOutcome) flags.push("No expected outcome provided");
    if (project.description.trim().length < 120) flags.push("Project description is very short");
    if (milestones.length < 2) flags.push("Only one milestone — limited accountability checkpoints");

    const score = Math.max(20, 90 - flags.length * 18);
    return {
      score,
      recommendation: recommendationFromScore(score),
      reasoning:
        "Mock screening: heuristic review of completeness (problem/outcome, description length, milestone breakdown). Configure GEMINI_API_KEY for a full AI assessment.",
      flags,
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const milestoneLines = milestones
    .map(
      (m, i) =>
        `  ${i + 1}. ${m.title} — ₹${m.targetAmount}, due ${m.deadline}\n     ${m.description}`
    )
    .join("\n");

  const prompt = `You are a due-diligence officer for a charitable donation platform in India. A verified NGO has submitted a new fundraising project for approval before it goes live to donors. Assess whether it is trustworthy, realistic, and well-formed.

PROJECT
- Title: ${project.title}
- Cause Category: ${project.causeCategory}
- Location: ${project.location}
- Total Target Amount: ₹${project.targetAmount}
- Description: ${project.description}
- Problem Statement: ${project.problemStatement || "(not provided)"}
- Expected Outcome: ${project.expectedOutcome || "(not provided)"}

MILESTONES (funding breakdown)
${milestoneLines}

Score the project from 0 to 100 on:
- Clarity & specificity: is the problem, plan, and outcome concrete and coherent? (30 points)
- Budget realism: is the total target and the per-milestone allocation reasonable for the stated work and location? Flag amounts that look inflated, round-number padded, or implausibly low. (25 points)
- Milestone quality: are milestones measurable, sequenced, and tied to verifiable deliverables? (25 points)
- Trust & red flags: vague/grandiose claims, mismatch between problem and outcome, signs of duplication/boilerplate, anything that suggests fraud or misuse. (20 points)

Then give:
- A recommendation: "APPROVE" (strong, publish as-is), "REVIEW" (admin should read carefully / request changes), or "REJECT" (serious problems).
- Concise reasoning (2-4 sentences).
- A list of specific flags an admin should look at (empty array if none).

Return ONLY valid JSON matching the required schema. No markdown, no preamble.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [prompt],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            recommendation: { type: Type.STRING, enum: ["APPROVE", "REVIEW", "REJECT"] },
            reasoning: { type: Type.STRING },
            flags: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["score", "recommendation", "reasoning", "flags"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini API");
    }

    const result = JSON.parse(text);
    const score = typeof result.score === "number" ? result.score : 0;
    const recommendation: ProjectScreeningResult["recommendation"] =
      result.recommendation === "APPROVE" || result.recommendation === "REJECT" || result.recommendation === "REVIEW"
        ? result.recommendation
        : recommendationFromScore(score);

    return {
      score,
      recommendation,
      reasoning: result.reasoning || "",
      flags: Array.isArray(result.flags) ? result.flags : [],
    };
  } catch (err: any) {
    console.error("Gemini project screening API error:", err);
    throw new Error(`Gemini project screening failed: ${err.message}`);
  }
}
