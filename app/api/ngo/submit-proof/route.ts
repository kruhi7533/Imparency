import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { validateMilestoneProof } from "@/lib/gemini/validate-proof";
import { Role } from "@prisma/client";
import { recalculateNGOHealthScore } from "@/lib/ngo-health";
import { extractGpsFromImage, classifyProofLocation } from "@/lib/proof-location";
import { findPriorEvidence } from "@/lib/evidence-duplicates";
import { hashBuffer } from "@/lib/proof-hash";
import { checkAttachableEvidence, loadEvidenceForCheck } from "@/lib/proof-field-evidence";
import {
  classifyDuplicate,
  duplicateSeverity,
  buildDuplicateDescription,
  type PriorProofMatch,
} from "@/lib/proof-fingerprint";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rl = await checkRateLimit(request, "ngo/submit-proof", 20, 600);
  if (rl.isBlocked) return rl.response;
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

    // Approved field evidence attached by reference (lib/proof-field-evidence.ts).
    const fieldEvidenceRequested = formData.getAll("fieldEvidenceIds").filter((v): v is string => typeof v === "string");

    if (files.length === 0 && fieldEvidenceRequested.length === 0) {
      return NextResponse.json({ error: "Attach at least one proof file or approved field evidence" }, { status: 400 });
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

    // Enforce strict file type allowlist (protect against stored-XSS and arbitrary file uploads)
    const ALLOWED_MIME_TYPES = new Set([
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ]);

    const DANGEROUS_EXTENSIONS = /\.(html?|svg|xml|js|mjs|exe|bat|sh|php|py|jar|cgi)$/i;

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
        return NextResponse.json(
          { error: `File "${file.name}" has an unsupported format (${file.type || "unknown"}). Only JPEG, PNG, WebP, HEIC images and PDF documents are allowed.` },
          { status: 400 }
        );
      }
      if (DANGEROUS_EXTENSIONS.test(file.name)) {
        return NextResponse.json(
          { error: `File "${file.name}" has a disallowed extension for proof evidence.` },
          { status: 400 }
        );
      }
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

    const attached = checkAttachableEvidence(fieldEvidenceRequested, await loadEvidenceForCheck(fieldEvidenceRequested), {
      ngoId: user.ngoProfile.id,
      projectId: milestone.projectId,
      milestoneId: milestone.id,
    });
    if (!attached.ok) return NextResponse.json({ error: attached.error }, { status: attached.status });
    const fieldEvidenceIds = attached.ids;

    // Upload files and convert to buffers for Gemini API
    const mediaUrls: string[] = [];
    const documentUrls: string[] = [];
    const fileBuffers: { buffer: Buffer; mimeType: string }[] = [];

    // SHA-256 per file, taken from the buffer that is already in memory for the
    // AI call — so fingerprinting costs one pass over bytes already read, and
    // adds no dependency and no second download.
    const contentHashes: string[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fileBuffers.push({ buffer, mimeType: file.type });
      contentHashes.push(hashBuffer(buffer));

      // Save to storage
      const fileUrl = await uploadFile(buffer, file.name, `proofs/${milestoneId}`);

      if (file.type.startsWith("image/")) {
        mediaUrls.push(fileUrl);
      } else {
        documentUrls.push(fileUrl);
      }
    }

    // GPS provenance — read from the first uploaded image's EXIF data, if
    // present. Best-effort: a metadata-extraction failure must never block a
    // submission, which is why extractGpsFromImage itself never throws (see
    // lib/proof-location.ts) and this is not wrapped further here.
    const firstImage = fileBuffers.find((f) => f.mimeType.startsWith("image/"));
    const proofCoordinates = firstImage ? await extractGpsFromImage(firstImage.buffer) : null;

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
      // Attached field evidence is described to the model, never sent: its
      // photos are consent-gated and a human has already reviewed them.
      fieldEvidenceIds.length > 0
        ? `${description}

[Also attached: ${fieldEvidenceIds.length} field evidence item(s) already approved by a platform reviewer.]`
        : description,
      fileBuffers
    );

    // Earlier proofs sharing a file with this submission. Queried BEFORE the
    // new row is written, so the submission cannot match itself — the
    // alternative (querying afterwards and excluding the new id) is one easy
    // mistake away from every proof flagging itself as a duplicate.
    //
    // Best-effort like the GPS read: a failure here must not cost an NGO its
    // submission, so it is caught and logged rather than thrown.
    let priorMatches: PriorProofMatch[] = [];
    try {
      // Both evidence tables: a photo first captured in the field app and then
      // reused here must be seen too (lib/evidence-duplicates.ts).
      priorMatches = await findPriorEvidence(contentHashes);
    } catch (hashErr) {
      console.error("Failed to check proof fingerprints for duplicates:", hashErr);
    }

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
        proofLatitude: proofCoordinates?.latitude ?? null,
        proofLongitude: proofCoordinates?.longitude ?? null,
        gpsSource: proofCoordinates ? "EXIF" : null,
        contentHashes,
        fieldEvidenceIds,
      },
    });

    // Run Gemini score risk checks (creates RiskReview for admin — no auto-suspension)
    try {
      const { checkGeminiScore } = require("@/lib/risk-agent");
      await checkGeminiScore(milestone.id, validationResult.score);
    } catch (fraudErr) {
      console.error("Failed to run Gemini score risk check:", fraudErr);
    }

    // GPS mismatch check — informational NO_GPS_DATA is not alert-worthy (most
    // phones strip location metadata; flagging every such submission would
    // flood the queue the same way flagging every NGO with no 12A/80G would).
    // Only an actual MISMATCH — a photo taken far from the project's
    // registered site — raises a HIGH alert for a human to look at.
    try {
      const locationResult = classifyProofLocation(
        proofCoordinates,
        milestone.project.latitude != null && milestone.project.longitude != null
          ? { latitude: milestone.project.latitude, longitude: milestone.project.longitude }
          : null
      );
      if (locationResult.status === "MISMATCH") {
        const { createFraudAlert } = await import("@/lib/fraud-alerts");
        await createFraudAlert(
          "PROOF_LOCATION_MISMATCH",
          milestone.id,
          "NGO",
          `Milestone "${milestone.title}" proof photo was taken ~${Math.round(
            locationResult.distanceKm ?? 0
          )}km from the project's registered site.`,
          "HIGH",
          "FRAUD_ALERT"
        );
      }
    } catch (locationErr) {
      console.error("Failed to run proof location check:", locationErr);
    }

    // Duplicate-evidence check. A RESUBMISSION — the same files against the
    // same milestone — raises nothing: an organisation re-uploading after a
    // rejection or fixing a description legitimately sends the same
    // photographs, and alerting on that would teach admins to ignore this
    // alert type. Only evidence crossing a milestone (MEDIUM) or a project or
    // organisation boundary (HIGH) is a human's problem.
    try {
      const duplicate = classifyDuplicate(priorMatches, {
        milestoneId: milestone.id,
        projectId: milestone.projectId,
        ngoId: user.ngoProfile.id,
      });
      const severity = duplicateSeverity(duplicate.verdict);
      if (severity) {
        const { createFraudAlert } = await import("@/lib/fraud-alerts");
        await createFraudAlert(
          "PROOF_DUPLICATE_MEDIA",
          milestone.id,
          "NGO",
          buildDuplicateDescription(duplicate, milestone.title),
          severity,
          "FRAUD_ALERT"
        );
      }
    } catch (duplicateErr) {
      console.error("Failed to run proof duplicate check:", duplicateErr);
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
        body: `The NGO submitted ${files.length + fieldEvidenceIds.length} item(s) of evidence for this milestone. Our admin team is reviewing it — you'll be notified once it's verified.`,
        // No media here: this event fires BEFORE admin review, and the feed
        // would show donors unreviewed photos. Media travels on the
        // MILESTONE_COMPLETED event that review-proof emits on approval.
        payload: { proofId: proof.id, aiScore: validationResult.score },
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
