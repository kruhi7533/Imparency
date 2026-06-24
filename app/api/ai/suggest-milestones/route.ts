import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { verifySessionRole } from "@/lib/auth-guards";

export async function POST(request: Request) {
  try {
    // 1. Guard check: only NGO users can access
    const { authorized, response: authResponse } = await verifySessionRole("NGO");
    if (!authorized) return authResponse;

    // 2. Parse request body
    const body = await request.json();
    const {
      project_title,
      cause_category,
      target_amount,
      description,
      problem_statement = "",
      expected_outcome = "",
      location = "",
    } = body;

    if (!project_title || !cause_category || !target_amount || !description) {
      return NextResponse.json(
        { error: "Missing required fields (project_title, cause_category, target_amount, description)" },
        { status: 400 }
      );
    }

    const totalTarget = Number(target_amount);
    if (isNaN(totalTarget) || totalTarget <= 0) {
      return NextResponse.json({ error: "Invalid target_amount" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    let suggestedMilestones: any[] = [];

    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not defined. Falling back to Mock milestone suggestion in development.");
      const amt1 = Math.round(totalTarget * 0.4);
      const amt2 = Math.round(totalTarget * 0.4);
      const amt3 = totalTarget - amt1 - amt2; // ensure exact sum

      suggestedMilestones = [
        {
          title: "Procurement & Site Setup",
          target_amount: amt1,
          suggested_deadline_days_from_now: 30,
          proof_type_required: "RECEIPT_AND_PHOTO",
          description: `Acquire initial resources, prepare the execution site in ${location || "the target area"}, and complete vendor onboarding.`,
        },
        {
          title: "Execution & Deployment",
          target_amount: amt2,
          suggested_deadline_days_from_now: 60,
          proof_type_required: "PHOTO_EVIDENCE",
          description: `Deploy resources and launch primary operations for "${project_title}" to serve local beneficiaries.`,
        },
        {
          title: "Impact Audit & Review",
          target_amount: amt3,
          suggested_deadline_days_from_now: 90,
          proof_type_required: "DOCUMENT_UPLOAD",
          description: `Conduct survey, compile deliverables report, and perform external audit to verify project completion.`,
        },
      ];
    } else {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are helping an NGO break down a fundraising campaign into 3-4 sequential, logical milestones.

Project Title: ${project_title}
Cause Category: ${cause_category}
Total Target Amount: ₹${totalTarget}
Location: ${location}
Description: ${description}
Problem Statement: ${problem_statement}
Expected Outcome: ${expected_outcome}

Break this campaign into 3-4 sequential milestones that represent logical phases of execution 
(e.g., procurement, distribution/implementation, follow-up/verification). 

Rules:
- The target_amount values across all milestones must sum EXACTLY to ₹${totalTarget}. Double-check your math before responding.
- Order milestones in the logical sequence they would actually happen (earlier milestones should have earlier suggested_deadline_days_from_now values)
- suggested_deadline_days_from_now should be reasonable spacing (e.g., 20-30 days apart between milestones), starting at least 14 days from now for the first milestone
- Choose proof_type_required based on what's appropriate for that specific milestone's activity (e.g., RECEIPT_AND_PHOTO for purchases, PHOTO_EVIDENCE for distribution/installation events, DOCUMENT_UPLOAD for assessments/reports)
- Each description should be 1-2 specific sentences about what that milestone involves

Return ONLY valid JSON matching the schema. No markdown, no preamble.`;

      const geminiResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              milestones: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    target_amount: { type: Type.INTEGER },
                    suggested_deadline_days_from_now: { type: Type.INTEGER },
                    proof_type_required: { type: Type.STRING },
                    description: { type: Type.STRING },
                  },
                  required: [
                    "title",
                    "target_amount",
                    "suggested_deadline_days_from_now",
                    "proof_type_required",
                    "description",
                  ],
                },
              },
            },
            required: ["milestones"],
          },
        },
      });

      const responseText = geminiResponse.text?.trim() || "";
      if (!responseText) {
        throw new Error("No response received from Gemini API");
      }

      const parsed = JSON.parse(responseText);
      if (!parsed.milestones || !Array.isArray(parsed.milestones)) {
        throw new Error("Invalid response format received from Gemini API");
      }

      suggestedMilestones = parsed.milestones;
    }

    // Validation safety net: check if milestones sum exactly to target amount, adjust the last one if not.
    if (suggestedMilestones.length > 0) {
      let sum = 0;
      for (const m of suggestedMilestones) {
        sum += Number(m.target_amount) || 0;
      }
      if (sum !== totalTarget) {
        const diff = totalTarget - sum;
        suggestedMilestones[suggestedMilestones.length - 1].target_amount =
          Number(suggestedMilestones[suggestedMilestones.length - 1].target_amount) + diff;
      }
    }

    // Map proof types to standard select values in application
    // ("Photo Evidence", "Receipt + Photo", "Document Upload", "Any")
    const proofTypeMap: Record<string, string> = {
      PHOTO_EVIDENCE: "Photo Evidence",
      RECEIPT_AND_PHOTO: "Receipt + Photo",
      DOCUMENT_UPLOAD: "Document Upload",
      ANY: "Any",
    };

    const formattedMilestones = suggestedMilestones.map((m) => {
      // Map proof type or default to Photo Evidence
      let mappedProofType = "Photo Evidence";
      const rawProofType = (m.proof_type_required || "").toUpperCase().replace(/\s+/g, "_");
      if (proofTypeMap[rawProofType]) {
        mappedProofType = proofTypeMap[rawProofType];
      } else if (Object.values(proofTypeMap).includes(m.proof_type_required)) {
        mappedProofType = m.proof_type_required;
      }

      // Convert suggested_deadline_days_from_now to target ISO date string split by 'T'
      const days = Number(m.suggested_deadline_days_from_now) || 30;
      const deadlineDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      const deadlineStr = deadlineDate.toISOString().split("T")[0];

      return {
        title: m.title.trim(),
        targetAmount: String(m.target_amount),
        deadline: deadlineStr,
        proofType: mappedProofType,
        description: m.description.trim(),
      };
    });

    return NextResponse.json({ milestones: formattedMilestones });
  } catch (err: any) {
    console.error("AI Milestone Suggestion API Error:", err);
    return NextResponse.json(
      { error: "Couldn't generate suggestions, please add milestones manually." },
      { status: 500 }
    );
  }
}
