import { GoogleGenAI, Type } from "@google/genai";
import {
  type BudgetStatus,
  ALLOWED_BUDGET_STATUSES,
  isBudgetViolation,
  normalizeBudgetStatus,
} from "@/lib/budget-rule";

// The budget rule lives in lib/budget-rule.ts (no deps) so the admin client can
// share it without bundling the Gemini SDK. Re-exported here for existing importers.
export {
  type BudgetStatus,
  BUDGET_VIOLATION_STATUSES,
  isBudgetViolation,
  parseValidationResult,
  getBudgetVerdict,
} from "@/lib/budget-rule";

export interface ValidationResult {
  score: number;
  reasoning: string;
  flags: string[];
  suggestion?: string;
  tocAlignmentScore?: number;
  tocReasoning?: string;
  tocStrengths?: string[];
  tocGaps?: string[];
  // ── Strict budget compliance ──────────────────────────────────────────────
  budgetStatus: BudgetStatus;
  budgetClaimedAmount: number | null; // total spend evidenced in the proof, in ₹ (null if none)
  budgetReasoning: string;
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

    // Strict budget rule (mock): require some financial signal in the text or a
    // document attachment; otherwise it's a NO_EVIDENCE violation.
    const mentionsMoney = /receipt|invoice|bill|₹|rs\.?\s*\d|\bspent\b|\bcost\b/i.test(proofDescription);
    const hasDoc = fileBuffers.some((f) => !f.mimeType.startsWith("image/"));
    const budgetStatus: BudgetStatus = mentionsMoney || hasDoc ? "ALIGNED" : "NO_EVIDENCE";
    const budgetClaimedAmount = budgetStatus === "ALIGNED" ? milestone.targetAmount : null;
    const budgetReasoning =
      budgetStatus === "ALIGNED"
        ? "Mock Validation: financial evidence detected; assumed to align with the milestone budget."
        : "Mock Validation: no receipts, invoices, or spend figures were provided — budget cannot be verified.";
    if (budgetStatus === "NO_EVIDENCE") flags.push("No financial evidence provided for the milestone budget");

    return {
      score,
      reasoning,
      flags,
      suggestion,
      tocAlignmentScore,
      tocReasoning,
      tocStrengths,
      tocGaps,
      budgetStatus,
      budgetClaimedAmount,
      budgetReasoning,
    };
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

TASK 3: BUDGET COMPLIANCE — STRICT, MANDATORY RULE
This is a hard financial-accountability rule. The milestone budget is ₹${milestone.targetAmount}. You MUST evaluate budget on EVERY proof — never skip it.
Steps:
1. Look for financial evidence: receipts, invoices, bills, or an explicit spend figure in the description.
2. If there is NO such financial evidence at all, you MUST return budgetStatus = "NO_EVIDENCE" and budgetClaimedAmount = null. Do NOT assume the budget was spent correctly just because photos exist.
3. If evidence exists, add up the total evidenced spend into budgetClaimedAmount (a plain number in ₹, no currency symbol) and compare it to the ₹${milestone.targetAmount} budget:
   - Within ~10% of the budget → "ALIGNED"
   - Materially below (more than ~10% under) → "UNDER_BUDGET"
   - Above the budget by any clear margin → "OVER_BUDGET"
4. If files are present but you cannot determine the amounts, return "UNCLEAR".
5. budgetReasoning: one or two sentences stating exactly what financial evidence you saw (or that none was provided) and how the total compares to the budget.
6. ENFORCEMENT: if budgetStatus is anything other than "ALIGNED" or "UNDER_BUDGET" (i.e. OVER_BUDGET, NO_EVIDENCE, or UNCLEAR), you MUST add a clear budget flag to the "flags" array, e.g. "Budget: no receipts provided" or "Budget: claimed ₹X exceeds the ₹Y milestone budget".

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
            tocGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
            budgetStatus: {
              type: Type.STRING,
              enum: ALLOWED_BUDGET_STATUSES,
            },
            budgetClaimedAmount: { type: Type.NUMBER, nullable: true },
            budgetReasoning: { type: Type.STRING }
          },
          required: ["score", "reasoning", "flags", "tocAlignmentScore", "tocReasoning", "tocStrengths", "tocGaps", "budgetStatus", "budgetReasoning"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini API");
    }

    const result = JSON.parse(text);

    const budgetStatus = normalizeBudgetStatus(result.budgetStatus);
    const budgetClaimedAmount =
      typeof result.budgetClaimedAmount === "number" ? result.budgetClaimedAmount : null;
    const flags = Array.isArray(result.flags) ? result.flags : [];
    // Safety net: enforce the strict rule even if the model forgot to add a flag.
    if (isBudgetViolation(budgetStatus) && !flags.some((f: string) => /budget/i.test(f))) {
      flags.push(
        budgetStatus === "NO_EVIDENCE"
          ? "Budget: no financial evidence (receipts/invoices) provided"
          : budgetStatus === "OVER_BUDGET"
          ? "Budget: evidenced spend exceeds the milestone budget"
          : "Budget: spend could not be verified from the evidence"
      );
    }

    return {
      score: typeof result.score === "number" ? result.score : 0,
      reasoning: result.reasoning || "",
      flags,
      suggestion: result.suggestion,
      tocAlignmentScore: typeof result.tocAlignmentScore === "number" ? result.tocAlignmentScore : null,
      tocReasoning: result.tocReasoning || null,
      tocStrengths: Array.isArray(result.tocStrengths) ? result.tocStrengths : [],
      tocGaps: Array.isArray(result.tocGaps) ? result.tocGaps : [],
      budgetStatus,
      budgetClaimedAmount,
      budgetReasoning: result.budgetReasoning || "",
    };
  } catch (err: any) {
    console.error("Gemini proof validation API error:", err);
    throw new Error(`Gemini Validation failed: ${err.message}`);
  }
}
