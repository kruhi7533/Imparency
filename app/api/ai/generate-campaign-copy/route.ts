import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { verifySessionRole } from "@/lib/auth-guards";

export async function POST(request: Request) {
  try {
    // 1. Guard check: only NGO users can access
    const { authorized, response: authResponse } = await verifySessionRole("NGO");
    if (!authorized) return authResponse;

    // 2. Parse request body
    const body = await request.json();
    const { field_type, user_input, title, cause_category, target_amount, location } = body;

    if (!field_type || !user_input) {
      return NextResponse.json({ error: "Missing required fields (field_type, user_input)" }, { status: 400 });
    }

    if (!["description", "problem_statement", "expected_outcome", "milestone_description"].includes(field_type)) {
      return NextResponse.json({ error: "Invalid field_type" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not defined. Falling back to Mock copy generation in development.");
      let mockText = "";
      if (field_type === "description") {
        mockText = `Help us fund: ${title || "our new project"} in ${location || "our target area"}. With a target budget of ₹${(target_amount || "0").toLocaleString()}, this initiative focuses on ${cause_category || "community development"} by implementing key milestones. Based on our plans to ${user_input}, we will coordinate with local partners and track progress transparently for all donors.`;
      } else if (field_type === "problem_statement") {
        mockText = `In ${location || "our target area"}, local communities face severe challenges due to ${user_input || "lack of resources"}. This issue disproportionately affects vulnerable groups, leading to immediate barriers in their daily well-being and long-term development.`;
      } else if (field_type === "expected_outcome") {
        mockText = `Once the target of ₹${(target_amount || "0").toLocaleString()} is raised, we expect to successfully implement ${user_input || "our objectives"}, resulting in a measurable improvement for the target beneficiaries.`;
      } else if (field_type === "milestone_description") {
        const { milestone_title, parent_project_title } = body;
        mockText = `This milestone for "${milestone_title || "our milestone"}" under the project "${parent_project_title || "our project"}" will use the allocated ₹${(target_amount || "0").toLocaleString()} to execute our goals. Specifically, we will focus on: ${user_input}.`;
      }
      return NextResponse.json({ text: mockText });
    }

    const ai = new GoogleGenAI({ apiKey });
    let prompt = "";

    if (field_type === "description") {
      prompt = `You are helping an NGO write a clear, donor-friendly project description for a fundraising platform.

Project Title: ${title || "Untitled"}
Cause Category: ${cause_category || "General"}
Location: ${location || "Not specified"}
Target Amount: ₹${target_amount || "0"}
NGO's rough notes: ${user_input}

Write a 2-3 sentence description explaining what this campaign will do with the funds. 
Be concrete and specific, not vague or overly emotional. Write in third person, professional but warm tone.
Return ONLY the description text, no preamble, no markdown formatting.`;
    } else if (field_type === "problem_statement") {
      prompt = `You are helping an NGO articulate the problem their campaign addresses.

Project Title: ${title || "Untitled"}
Cause Category: ${cause_category || "General"}
Location: ${location || "Not specified"}
NGO's rough notes: ${user_input}

Write a 1-2 sentence problem statement describing the issue or gap this campaign addresses. 
Include a specific, believable detail (a number, a barrier, a consequence) to make it concrete rather than generic.
Return ONLY the problem statement text, no preamble, no markdown formatting.`;
    } else if (field_type === "expected_outcome") {
      prompt = `You are helping an NGO describe what success looks like for their campaign.

Project Title: ${title || "Untitled"}
Cause Category: ${cause_category || "General"}
Target Amount: ₹${target_amount || "0"}
NGO's rough notes: ${user_input}

Write a 1-2 sentence expected outcome describing the measurable or observable result once this campaign is fully funded and completed.
Where reasonable, include a specific measurable detail (a count, a percentage, a timeframe).
Return ONLY the expected outcome text, no preamble, no markdown formatting.`;
    } else if (field_type === "milestone_description") {
      const { milestone_title, proof_type_required, parent_project_title } = body;
      prompt = `You are helping an NGO write a clear description for a single fundraising milestone.

Milestone Title: ${milestone_title || "Untitled"}
Target Amount: ₹${target_amount || "0"}
Proof Type Required: ${proof_type_required || "Photo Evidence"}
Parent Project Title: ${parent_project_title || "Untitled"}
Parent Project Cause Category: ${cause_category || "General"}
NGO's rough notes: ${user_input}

Write a 1-2 sentence description explaining exactly what this milestone involves and how the funds will be used.
Be concrete and specific. Write in third person.
Return ONLY the description text, no preamble, no markdown formatting.`;
    }

    const geminiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const generatedText = geminiResponse.text?.trim() || "";
    if (!generatedText) {
      throw new Error("No response text received from Gemini API");
    }

    return NextResponse.json({ text: generatedText });
  } catch (err: any) {
    console.error("AI Copywriting generation endpoint error:", err);
    return NextResponse.json(
      { error: "Generation failed, please try again or write manually." },
      { status: 500 }
    );
  }
}
