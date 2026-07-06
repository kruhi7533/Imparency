import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { validateMilestoneProof } from "@/lib/gemini/validate-proof";
import { Role } from "@prisma/client";
import { recalculateNGOHealthScore } from "@/lib/ngo-health";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.NGO);
  if (!auth.authorized) {
    return auth.response;
  }

  const userId = auth.session.user.id;

  try {
    const formData = await request.formData();
    const milestoneId = formData.get("milestoneId") as string;
    const description = formData.get("description") as string;

    if (!milestoneId || !description) {
      return NextResponse.json({ error: "Milestone ID and description are required" }, { status: 400 });
    }

    // Extract files from formData
    const files: File[] = [];
    formData.forEach((value) => {
      if (value instanceof File) {
        files.push(value);
      }
    });

    if (files.length === 0) {
      return NextResponse.json({ error: "At least one proof file is required" }, { status: 400 });
    }

    // Enforce max 5 files
    if (files.length > 5) {
      return NextResponse.json({ error: "Maximum of 5 files can be uploaded as proof" }, { status: 400 });
    }

    // Validate combined file size <= 20MB
    let totalSize = 0;
    for (const file of files) {
      totalSize += file.size;
    }

    if (totalSize > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Combined file size exceeds the 20MB limit" }, { status: 400 });
    }

    // Fetch user and NGO Profile
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { ngoProfile: true },
    });

    if (!user?.ngoProfile || user.ngoProfile.verificationStatus !== "VERIFIED") {
      return NextResponse.json({ error: "Only verified NGO profiles can submit proofs" }, { status: 403 });
    }

    if (user.ngoProfile.isSuspended) {
      return NextResponse.json({ error: "Your NGO profile has been suspended from submitting proofs" }, { status: 403 });
    }

    // Fetch milestone and project
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: { project: true },
    });

    if (!milestone || milestone.project.ngoId !== user.ngoProfile.id) {
      return NextResponse.json({ error: "Milestone not found or unauthorized" }, { status: 404 });
    }

    if (milestone.status === "COMPLETED" || milestone.status === "VERIFIED") {
      return NextResponse.json({ error: "Milestone is already completed" }, { status: 400 });
    }

    // Upload files and convert to buffers for Gemini API
    const mediaUrls: string[] = [];
    const documentUrls: string[] = [];
    const fileBuffers: { buffer: Buffer; mimeType: string }[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fileBuffers.push({ buffer, mimeType: file.type });

      // Save to storage
      const fileUrl = await uploadFile(buffer, file.name, `proofs/${milestoneId}`);

      if (file.type.startsWith("image/")) {
        mediaUrls.push(fileUrl);
      } else {
        documentUrls.push(fileUrl);
      }
    }

    // Invoke Gemini AI Validation
    const validationResult = await validateMilestoneProof(
      {
        title: milestone.title,
        description: milestone.description,
        targetAmount: Number(milestone.targetAmount),
        deadline: milestone.deadline,
        proofTypeRequired: "Photo/Document Evidence",
      },
      {
        problemStatement: milestone.project.problem_statement || "Not specified",
        expectedOutcome: milestone.project.expected_outcome || "Not specified",
      },
      description,
      fileBuffers
    );

    // Save MilestoneProof details
    const proof = await prisma.milestoneProof.create({
      data: {
        milestoneId: milestone.id,
        submittedById: userId,
        description,
        mediaUrls,
        documentUrls,
        aiValidationResult: JSON.stringify(validationResult),
        aiValidationScore: validationResult.score,
        theoryOfChangeAlignmentScore: validationResult.tocAlignmentScore,
        theoryOfChangeReasoning: validationResult.tocReasoning,
        theoryOfChangeStrengths: validationResult.tocStrengths || [],
        theoryOfChangeGaps: validationResult.tocGaps || [],
      },
    });

    // Run Gemini score risk checks (creates RiskReview for admin — no auto-suspension)
    try {
      const { checkGeminiScore } = require("@/lib/risk-agent");
      await checkGeminiScore(milestone.id, validationResult.score);
    } catch (fraudErr) {
      console.error("Failed to run Gemini score risk check:", fraudErr);
    }

    // Always queue for admin review — milestones never auto-complete regardless of AI score.
    // The AI score is surfaced to the admin as a recommendation, not a decision.
    await prisma.milestone.update({
      where: { id: milestone.id },
      data: { status: "PROOF_SUBMITTED" },
    });

    // Impact feed: tell subscribed donors that proof was submitted (pending
    // verification — the wording matters; nothing is "verified" yet).
    try {
      const { emitProjectImpactEvent } = await import("@/lib/impact-events");
      await emitProjectImpactEvent({
        projectId: milestone.projectId,
        milestoneId: milestone.id,
        type: "PROOF_SUBMITTED",
        title: `Progress proof submitted for "${milestone.title}"`,
        body: `The NGO submitted ${files.length} file(s) of evidence for this milestone. Our admin team is reviewing it — you'll be notified once it's verified.`,
        payload: { proofId: proof.id, mediaUrls, aiScore: validationResult.score },
      });
    } catch (impactErr) {
      console.error("Failed to emit impact event on proof submission:", impactErr);
    }

    // Recalculate NGO health score
    try {
      await recalculateNGOHealthScore(user.ngoProfile.id);
    } catch (healthErr) {
      console.error("Failed to recalculate health score on proof submission:", healthErr);
    }

    console.log(`Milestone proof submitted for ${milestone.id}. AI Score: ${validationResult.score}. Awaiting admin review.`);

    return NextResponse.json({
      success: true,
      score: validationResult.score,
      reasoning: validationResult.reasoning,
      flags: validationResult.flags,
      suggestion: validationResult.suggestion,
      proofId: proof.id,
      status: "PROOF_SUBMITTED",
    });

  } catch (err: any) {
    console.error("Proof submission endpoint error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
