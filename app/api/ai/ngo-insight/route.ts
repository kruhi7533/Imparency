import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";

// Simple in-memory cache: ngoId -> { text, generatedAt }
const insightCache = new Map<string, { text: string; generatedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function GET(req: NextRequest) {
  try {
    // Use the project's established auth helper (same as other AI routes)
    const { authorized, response: authResponse, session } = await verifySessionRole("NGO");
    if (!authorized) {
      console.error("[ngo-insight] Auth failed — no valid NGO session");
      return authResponse;
    }

    // Resolve ngo_id from query param or fall back to session user's profile
    const { searchParams } = new URL(req.url);
    const ngoIdParam = searchParams.get("ngo_id");
    // Pass ?bust=1 to force a fresh generation (ignores cache)
    const bustCache = searchParams.get("bust") === "1";

    let ngoId: string;
    if (ngoIdParam) {
      ngoId = ngoIdParam;
    } else {
      const profile = await prisma.nGOProfile.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      });
      if (!profile) {
        console.error("[ngo-insight] NGO profile not found for userId:", session.user.id);
        return NextResponse.json({ error: "NGO profile not found" }, { status: 404 });
      }
      ngoId = profile.id;
    }

    // Return cached insight if still fresh (unless bust requested)
    const cached = insightCache.get(ngoId);
    if (!bustCache && cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
      console.log(`[ngo-insight] Cache hit for ngoId: ${ngoId} — "${cached.text}"`);
      return NextResponse.json({ insight: cached.text, cached: true });
    }

    // Fetch the NGO's health data + project summary
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      select: {
        orgName: true,
        healthScore: true,
        healthScoreBreakdown: true,
        projects: {
          where: { isDeleted: false },
          select: {
            status: true,
            raisedAmount: true,
            targetAmount: true,
            milestones: {
              select: { status: true },
            },
          },
        },
      },
    });

    if (!ngo) {
      console.error("[ngo-insight] NGO record not found for ngoId:", ngoId);
      return NextResponse.json({ error: "NGO not found" }, { status: 404 });
    }

    const healthScore =
      ngo.healthScore !== null && ngo.healthScore !== undefined
        ? Number(ngo.healthScore)
        : null;

    const breakdown = ngo.healthScoreBreakdown as Record<
      string,
      { score: number | null; weight: number }
    > | null;

    const activeProjects = ngo.projects.filter((p) => p.status === "ACTIVE");
    const totalRaised = ngo.projects.reduce(
      (sum, p) => sum + Number(p.raisedAmount),
      0
    );
    const totalTarget = ngo.projects.reduce(
      (sum, p) => sum + Number(p.targetAmount),
      0
    );
    const allMilestones = ngo.projects.flatMap((p) => p.milestones);
    const completedMilestones = allMilestones.filter(
      (m) => m.status === "COMPLETED" || m.status === "VERIFIED"
    ).length;
    const pendingMilestones = allMilestones.filter(
      (m) => m.status === "PENDING" || m.status === "IN_PROGRESS"
    ).length;
    const proofSubmittedMilestones = allMilestones.filter(
      (m) => m.status === "PROOF_SUBMITTED"
    ).length;

    const isHealthPending = healthScore === null;

    console.log(
      `[ngo-insight] Generating for "${ngo.orgName}" — healthScore: ${healthScore}, ` +
      `breakdownPresent: ${breakdown !== null}, milestones: ${allMilestones.length}, ` +
      `raised: ₹${totalRaised}`
    );

    // Build context block — if breakdown is null but score exists, still give Gemini the score
    const breakdownText = breakdown
      ? `Health Score Breakdown:
  - Fund Utilization: ${breakdown.utilization?.score != null ? `${Number(breakdown.utilization.score).toFixed(1)}/100` : "N/A"} (weight: ${breakdown.utilization?.weight?.toFixed(0) ?? "?"}%)
  - Milestone Completion: ${breakdown.completion?.score != null ? `${Number(breakdown.completion.score).toFixed(1)}/100` : "N/A"} (weight: ${breakdown.completion?.weight?.toFixed(0) ?? "?"}%)
  - Proof Submission Speed: ${breakdown.speed?.score != null ? `${Number(breakdown.speed.score).toFixed(1)}/100` : "N/A"} (weight: ${breakdown.speed?.weight?.toFixed(0) ?? "?"}%)
  - Donor Return Rate: ${breakdown.donorReturn?.score != null ? `${Number(breakdown.donorReturn.score).toFixed(1)}/100` : "N/A"} (weight: ${breakdown.donorReturn?.weight?.toFixed(0) ?? "?"}%)`
      : `(Detailed breakdown not yet computed — overall score only)`;

    const contextBlock = isHealthPending
      ? `NGO Name: ${ngo.orgName}
Health Score: Not yet unlocked (needs 1 completed milestone + 3 donors)
Active Projects: ${activeProjects.length}
Total Milestones: ${allMilestones.length} (${completedMilestones} completed, ${pendingMilestones} pending, ${proofSubmittedMilestones} awaiting review)
Total Funds Raised: ₹${totalRaised.toLocaleString()} of ₹${totalTarget.toLocaleString()} target`
      : `NGO Name: ${ngo.orgName}
Overall Health Score: ${healthScore!.toFixed(1)}/100
${breakdownText}
Active Projects: ${activeProjects.length}
Total Milestones: ${allMilestones.length} (${completedMilestones} completed, ${pendingMilestones} pending, ${proofSubmittedMilestones} awaiting review)
Total Funds Raised: ₹${totalRaised.toLocaleString()} of ₹${totalTarget.toLocaleString()} target`;

    const prompt = `You are a concise NGO performance advisor for ImpactBridge, a fundraising platform.
Given the following NGO dashboard data, write ONE short, specific, action-oriented sentence (max 18 words) telling the NGO the single most impactful thing they should do right now.

Rules:
- Be specific and direct. Reference their actual situation.
- Focus on the weakest metric or most urgent next action.
- Do NOT start with "Consider" or "You should".
- Output ONLY the single sentence. No explanation, no prefix, no quotes, no markdown.

Data:
${contextBlock}`;

    let insightText = "";

    try {
      const { GoogleGenAI } = await import("@google/genai");
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey || apiKey === "your-api-key-here") {
        throw new Error("No valid GEMINI_API_KEY configured");
      }

      const genAI = new GoogleGenAI({ apiKey });
      const result = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0.6,
          maxOutputTokens: 1000,
        },
      });

      const raw = result.text?.trim() ?? "";
      // Strip surrounding quotes if Gemini added them despite instructions
      insightText = raw.replace(/^["'`]+|["'`]+$/g, "").trim();

      if (!insightText) {
        throw new Error("Gemini returned empty text");
      }

      console.log(`[ngo-insight] Gemini succeeded: "${insightText}"`);
    } catch (geminiErr: any) {
      console.warn(
        `[ngo-insight] Gemini failed for "${ngo.orgName}" (using fallback): ${geminiErr?.message ?? geminiErr}`
      );

      // Rule-based fallback — always a complete, specific sentence
      if (isHealthPending) {
        insightText =
          "Complete your first milestone and attract 3 donors to unlock your NGO Health Score.";
      } else if (healthScore! < 50) {
        insightText =
          "Submit proof for pending milestones promptly to build donor trust and improve your health score.";
      } else if (healthScore! < 80) {
        insightText =
          "Accelerate proof submissions and re-engage past donors to push your health score above 80.";
      } else {
        insightText =
          "Keep your momentum strong — launch a new campaign or submit any open milestone proofs now.";
      }
    }

    // Final safety net — should never be empty at this point
    if (!insightText) {
      insightText = "Keep up the momentum — timely milestone updates build long-term donor trust.";
    }

    console.log(`[ngo-insight] Final insight for "${ngo.orgName}": "${insightText}"`);

    // Cache the result
    insightCache.set(ngoId, { text: insightText, generatedAt: Date.now() });

    return NextResponse.json({ insight: insightText, cached: false });
  } catch (error: any) {
    console.error("[ngo-insight] Unexpected top-level error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
