import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { GoogleGenAI, Type } from "@google/genai";
import { callAi } from "@/lib/ai/telemetry";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const rl = await checkRateLimit(request, "ngo/toc-check", 10, 60);
  if (rl.isBlocked) return rl.response;
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || session.user.role !== "NGO") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.id;

    // 1. Fetch project with milestones
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        milestones: {
          orderBy: { sequenceOrder: 'asc' }
        },
        ngo: true
      }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Verify ownership
    if (project.ngo.userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized to access this project" }, { status: 403 });
    }

    // 2. Build Gemini prompt
    const prompt = `You are an NGO impact analyst. A project has the following Theory of Change components:

PROJECT GOAL: ${project.title}
PROBLEM STATEMENT: ${project.problem_statement || 'Not provided'}
EXPECTED OUTCOME (long-term impact): ${project.expected_outcome || 'Not provided'}
TOTAL BUDGET: ₹${project.targetAmount.toString()}

MILESTONES (activities + outputs):
${project.milestones.map((m: { title: string; description: string; targetAmount: { toString: () => string } }, i: number) => `${i + 1}. ${m.title}: ${m.description} (₹${m.targetAmount.toString()})`).join('\n')}

Analyse the causal chain: Inputs → Activities → Outputs → Outcomes → Impact.

Return ONLY valid JSON (no markdown) in this shape:
{
  "alignmentScore": <0-100>,
  "verdict": "strong" | "moderate" | "weak",
  "gaps": ["<gap 1>", "<gap 2>"],
  "strengths": ["<strength 1>"],
  "suggestion": "<one concrete improvement the NGO should make>"
}`;

    // 3. Call Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "AI analysis is not configured on this server — human review required.", code: "AI_NOT_CONFIGURED", humanReviewRequired: true },
        { status: 503 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const response = await callAi({ site: "toc-check", model: "gemini-3.6-flash", promptVersion: "v1" }, () => ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            alignmentScore: { type: Type.INTEGER },
            verdict: { type: Type.STRING },
            gaps: { type: Type.ARRAY, items: { type: Type.STRING } },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestion: { type: Type.STRING }
          },
          required: ["alignmentScore", "verdict", "gaps", "strengths", "suggestion"]
        }
      }
    }));

    if (!response.text) {
      throw new Error("Failed to generate Theory of Change analysis");
    }

    // 4. Parse the JSON response
    const tocAnalysis = JSON.parse(response.text);
    tocAnalysis.analyzedAt = new Date().toISOString();

    // 5. Save to project.tocAnalysis via Prisma
    await prisma.project.update({
      where: { id: projectId },
      data: {
        tocAnalysis: tocAnalysis
      }
    });

    // 6. Return the parsed object
    return NextResponse.json(tocAnalysis);

  } catch (error: any) {
    console.error("Error in Theory of Change analysis:", error);
    return NextResponse.json(
      // AI-010: no raw error text to the client, and nothing stored.
      { error: "AI unavailable — human review required. The Theory of Change analysis could not be generated.", code: "AI_UNAVAILABLE", humanReviewRequired: true },
      { status: 503 }
    );
  }
}
