import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { verifySessionRole } from "@/lib/auth-guards";

// Generates a unique join code like "ANANDA-7X3K"
function generateJoinCode(orgName: string): string {
  const prefix = orgName
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 6);
  const suffix = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `${prefix}-${suffix}`;
}

export async function POST(request: Request) {
  try {
    // 1. Guard check: only NGO users can register
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const userId = session.user.id;

    // 2. Parse form data
    const formData = await request.formData();
    
    const orgName = formData.get("orgName") as string;
    const registrationNumber = formData.get("registrationNumber") as string;
    const panNumber = formData.get("panNumber") as string;
    const address = formData.get("address") as string;
    const website = formData.get("website") as string || null;
    const foundedYearStr = formData.get("foundedYear") as string;
    const description = formData.get("description") as string;
    const causeCategoriesStr = formData.get("causeCategories") as string;

    const regFile = formData.get("regFile") as File | null;
    const panFile = formData.get("panFile") as File | null;
    const taxFile = formData.get("taxFile") as File | null;

    const dataProcessingConsent = formData.get("dataProcessingConsent") as string;
    const consentVersion = formData.get("consentVersion") as string || "v1.0";
    
    // Attempt to get client IP
    const consentIpAddress = request.headers.get("x-forwarded-for")?.split(',')[0] || request.headers.get("x-real-ip") || null;

    // Optional compliance documents (never block onboarding)
    const a12File = formData.get("a12File") as File | null;
    const fcraFile = formData.get("fcraFile") as File | null;
    const fcraNumber = (formData.get("fcraNumber") as string) || null;

    // 3. Field validation
    if (!orgName || !registrationNumber || !panNumber || !address || !foundedYearStr || !description || !causeCategoriesStr) {
      return NextResponse.json({ error: "Missing mandatory registration fields" }, { status: 400 });
    }

    const consent = dataProcessingConsent === "true";
    if (!consent) {
      return NextResponse.json({ error: "Data processing consent is required" }, { status: 400 });
    }

    const foundedYear = parseInt(foundedYearStr, 10);
    if (isNaN(foundedYear)) {
      return NextResponse.json({ error: "Invalid founded year" }, { status: 400 });
    }

    let causeCategories: string[] = [];
    try {
      causeCategories = JSON.parse(causeCategoriesStr);
    } catch {
      return NextResponse.json({ error: "Invalid cause categories format" }, { status: 400 });
    }

    if (causeCategories.length === 0) {
      return NextResponse.json({ error: "Select at least one cause category" }, { status: 400 });
    }

    // 4. File validations (MIME & Size)
    const files = [
      { name: "Registration Certificate", file: regFile },
      { name: "NGO PAN Card Copy", file: panFile },
      { name: "80G Registration Copy", file: taxFile }
    ];

    for (const f of files) {
      if (!f.file) {
        return NextResponse.json({ error: `Missing required file: ${f.name}` }, { status: 400 });
      }
      
      // Strict MIME validation
      if (f.file.type !== "application/pdf") {
        return NextResponse.json({ error: `File '${f.name}' must be a PDF document` }, { status: 400 });
      }

      // Strict Size validation: 10MB limit
      if (f.file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `File '${f.name}' exceeds the 10MB limit` }, { status: 400 });
      }
    }

    // 4b. Optional compliance file validations (same rules, only when provided)
    const optionalFiles = [
      { name: "12A Registration Copy", file: a12File },
      { name: "FCRA Certificate", file: fcraFile },
    ];
    for (const f of optionalFiles) {
      if (!f.file) continue;
      if (f.file.type !== "application/pdf") {
        return NextResponse.json({ error: `File '${f.name}' must be a PDF document` }, { status: 400 });
      }
      if (f.file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: `File '${f.name}' exceeds the 10MB limit` }, { status: 400 });
      }
    }

    // 5. Check if registration number or PAN is already used by another NGO
    const existingNGO = await prisma.nGOProfile.findFirst({
      where: {
        userId: { not: userId },
        OR: [
          { registrationNumber },
          { panNumber }
        ]
      }
    });

    if (existingNGO) {
      return NextResponse.json({ error: "An NGO is already registered with this Registration Number or PAN" }, { status: 400 });
    }

    // 5b. PAN API verification (non-blocking — fails open if provider is unavailable)
    let panMismatch = false;
    try {
      const { verifyPan, namesMatch } = await import("@/lib/pan-verification");
      const panResult = await verifyPan(panNumber);
      if (!panResult.valid) {
        return NextResponse.json(
          { error: "PAN number could not be verified in government records. Please check and resubmit." },
          { status: 400 }
        );
      }
      if (panResult.registeredName && !namesMatch(orgName, panResult.registeredName)) {
        panMismatch = true;
      }
    } catch (panErr) {
      console.error("PAN verification step failed:", panErr);
    }

    // 6. Upload files to Storage
    const uploadedUrls: string[] = [];
    for (const f of files) {
      const file = f.file!;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const url = await uploadFile(buffer, file.name, "documents");
      uploadedUrls.push(url);
    }

    // 6b. Upload optional compliance documents (when provided)
    let a12DocumentUrl: string | null = null;
    if (a12File) {
      const buffer = Buffer.from(await a12File.arrayBuffer());
      a12DocumentUrl = await uploadFile(buffer, a12File.name, "documents");
    }
    let fcraCertificateUrl: string | null = null;
    if (fcraFile) {
      const buffer = Buffer.from(await fcraFile.arrayBuffer());
      fcraCertificateUrl = await uploadFile(buffer, fcraFile.name, "documents");
    }

    // 7. Check if user already has an NGO Profile (resubmission flow)
    const currentProfile = await prisma.nGOProfile.findUnique({
      where: { userId }
    });

    let profile;
    if (currentProfile) {
      // Update existing profile (resubmit resets status to PENDING)
      profile = await prisma.nGOProfile.update({
        where: { id: currentProfile.id },
        data: {
          orgName,
          registrationNumber,
          panNumber,
          address,
          causeCategories,
          website,
          foundedYear,
          description,
          documents: uploadedUrls,
          verificationStatus: "PENDING",
          adminNote: null, // Reset previous notes
          dataProcessingConsent: true,
          dataProcessingConsentDate: new Date(),
          consentVersion,
          consentIpAddress,
        }
      });
    } else {
      // Create new NGO Profile
      profile = await prisma.nGOProfile.create({
        data: {
          userId,
          orgName,
          registrationNumber,
          panNumber,
          address,
          causeCategories,
          website,
          foundedYear,
          description,
          documents: uploadedUrls,
          verificationStatus: "PENDING",
          healthScore: null,
          dataProcessingConsent: true,
          dataProcessingConsentDate: new Date(),
          consentVersion,
          consentIpAddress,
          joinCode: generateJoinCode(orgName),
        }
      });
    }

    // Record consent audit log
    await prisma.consentAudit.create({
      data: {
        ngoId: profile.id,
        action: "GRANTED_REGISTRATION",
        version: consentVersion,
        ipAddress: consentIpAddress,
      }
    });

    // 7b. Upsert the compliance record with optional 12A / FCRA submissions.
    // 12A and FCRA are optional — their presence here only records the upload;
    // verified flags are set later by the admin. FCRA goes to PENDING for review.
    const fcraProvided = !!(fcraCertificateUrl || fcraNumber);
    try {
      const compliance = await prisma.nGOCompliance.upsert({
        where: { ngoId: profile.id },
        update: {
          ...(a12DocumentUrl ? { a12DocumentUrl } : {}),
          ...(fcraProvided
            ? {
                fcraNumber,
                fcraCertificateUrl,
                fcraStatus: "PENDING",
                // resubmission: clear any prior admin note / extraction
                fcraAdminNote: null,
                fcraExtractedData: undefined,
              }
            : {}),
        },
        create: {
          ngoId: profile.id,
          a12DocumentUrl,
          fcraNumber,
          fcraCertificateUrl,
          fcraStatus: fcraProvided ? "PENDING" : "NONE",
        },
      });

      if (fcraProvided) {
        const { logComplianceEvent } = await import("@/lib/ngo-compliance");
        await logComplianceEvent(
          compliance.id,
          "FCRA_UPLOADED",
          "NGO submitted FCRA certificate for review.",
          userId
        );

        // Fire-and-forget FCRA extraction (do NOT await — keep submission fast).
        if (fcraFile) {
          const fcraBuffer = Buffer.from(await fcraFile.arrayBuffer());
          (async () => {
            try {
              const { verifyFcraDocument } = await import("@/lib/gemini/verify-fcra-doc");
              const report = await verifyFcraDocument(orgName, fcraNumber, {
                buffer: fcraBuffer,
                filename: fcraFile.name,
                mimeType: "application/pdf",
              });
              await prisma.nGOCompliance.update({
                where: { id: compliance.id },
                data: { fcraExtractedData: report as any },
              });
            } catch (fcraErr) {
              console.error("Background FCRA extraction failed:", fcraErr);
            }
          })();
        }
      }
    } catch (complianceErr) {
      console.error("Failed to upsert NGO compliance record:", complianceErr);
      // Non-fatal: registration still succeeds; admin can request re-upload later.
    }

    // Trigger AI Document Verification Agent
    let aiReport = null;
    try {
      const { verifyNGODocuments } = require("@/lib/gemini/verify-ngo-docs");
      const { createFraudAlert } = require("@/lib/fraud-alerts");
      const regBuffer = Buffer.from(await regFile!.arrayBuffer());
      const panBuffer = Buffer.from(await panFile!.arrayBuffer());
      const taxBuffer = Buffer.from(await taxFile!.arrayBuffer());

      aiReport = await verifyNGODocuments(
        profile.id,
        orgName,
        registrationNumber,
        panNumber,
        [
          { buffer: regBuffer, filename: regFile!.name, mimeType: "application/pdf" },
          { buffer: panBuffer, filename: panFile!.name, mimeType: "application/pdf" },
          { buffer: taxBuffer, filename: taxFile!.name, mimeType: "application/pdf" }
        ]
      );

      if (aiReport) {
        await prisma.nGOProfile.update({
          where: { id: profile.id },
          data: { ai_verification_report: aiReport }
        });

        // Create one FraudAlert per HIGH flag, using its category from the AI report
        const highFlags = Array.isArray(aiReport.flags)
          ? aiReport.flags.filter((f: any) => f.severity === "HIGH")
          : [];

        for (const flag of highFlags) {
          const category = flag.category === "DOCUMENT_ERROR" ? "DOCUMENT_ERROR" : "FRAUD_ALERT";
          await createFraudAlert(
            category === "DOCUMENT_ERROR" ? "AI_DOCUMENT_ERROR" : "AI_DOCUMENT_VERIFICATION",
            profile.id,
            "NGO",
            flag.issue,
            "HIGH",
            category
          );
        }

        // If overall recommendation is LIKELY_FRAUD but no individual HIGH flags were flagged yet, create a summary alert
        if (aiReport.recommendation === "LIKELY_FRAUD" && highFlags.length === 0) {
          await createFraudAlert(
            "AI_DOCUMENT_VERIFICATION",
            profile.id,
            "NGO",
            aiReport.summary || "AI document verification marked profile as LIKELY_FRAUD.",
            "HIGH",
            "FRAUD_ALERT"
          );
        }
      }

      // PAN API mismatch alert (created after profile exists)
      if (panMismatch) {
        await createFraudAlert(
          "PAN_API_MISMATCH",
          profile.id,
          "NGO",
          `Organization name "${orgName}" does not match the name registered with the PAN number in government records.`,
          "HIGH",
          "FRAUD_ALERT",
          "PAN_API_MISMATCH"
        );
      }
    } catch (aiErr) {
      console.error("AI Document Verification failed:", aiErr);
      // Fail gracefully: let the admin proceed with manual review
    }

    // Fire-and-forget NGO pre-screening (do NOT await — keep submission fast).
    // This only writes a summary record; it never changes verification status.
    try {
      const { runAndStoreNgoScreening } = require("@/lib/screening-runner");
      runAndStoreNgoScreening(profile.id).catch((screenErr: any) =>
        console.error("Background NGO screening failed:", screenErr)
      );
    } catch (triggerErr) {
      console.error("Failed to trigger NGO screening:", triggerErr);
    }

    return NextResponse.json({ success: true, profileId: profile.id });
  } catch (err: any) {
    console.error("NGO Registration Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
