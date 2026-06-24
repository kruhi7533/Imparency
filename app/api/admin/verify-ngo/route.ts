import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { sendNGOApprovalEmail, sendNGORejectionEmail } from "@/lib/email";

export async function POST(request: Request) {
  try {
    // 1. Guard check: only Admin users can verify NGOs
    const { authorized, response, session } = await verifySessionRole("ADMIN");
    if (!authorized) return response;
    const adminId = session.user.id;

    // 2. Parse body
    const body = await request.json();
    const { ngoId, action, adminNote } = body;

    if (!ngoId || !action || !["APPROVE", "REJECT"].includes(action)) {
      return NextResponse.json({ error: "Missing required verification properties" }, { status: 400 });
    }

    if (action === "REJECT" && (!adminNote || !adminNote.trim())) {
      return NextResponse.json({ error: "Rejection note is required" }, { status: 400 });
    }

    // 3. Find NGO profile and its owner
    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      include: {
        user: { select: { email: true } },
        screening: { select: { flags: true } },
        compliance: { select: { id: true, a12DocumentUrl: true } },
      },
    });

    if (!ngo) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    // Server-side friction: require justification note to override LIKELY_FRAUD
    if (action === "APPROVE" && ngo.ai_verification_report) {
      const report = ngo.ai_verification_report as any;
      if (report.recommendation === "LIKELY_FRAUD" && (!adminNote || !adminNote.trim())) {
        return NextResponse.json({ error: "Justification note is required to override AI fraud warning." }, { status: 400 });
      }
    }

    const noteText = adminNote ? adminNote.trim() : "All documents verified successfully.";

    // On rejection, turn the terse admin note + AI flags into clear, actionable
    // guidance the NGO can act on. Degrades to the raw note on any failure.
    let ngoFacingNote = noteText;
    if (action === "REJECT") {
      try {
        const { composeRejectionGuidance } = await import("@/lib/gemini/explain-rejection");
        const aiReport = (ngo.ai_verification_report as any) || null;
        const screeningFlags = (ngo.screening?.flags as any) || [];
        const aiFlags = Array.isArray(aiReport?.flags) ? aiReport.flags : [];
        ngoFacingNote = await composeRejectionGuidance({
          orgName: ngo.orgName,
          adminNote: noteText,
          aiSummary: aiReport?.summary || null,
          flags: [...aiFlags, ...screeningFlags],
        });
      } catch (guidanceErr) {
        console.error("Failed to compose rejection guidance:", guidanceErr);
        ngoFacingNote = noteText;
      }
    }

    // 4. Update status in database
    const updatedStatus = action === "APPROVE" ? "VERIFIED" : "REJECTED";
    await prisma.nGOProfile.update({
      where: { id: ngoId },
      data: {
        verificationStatus: updatedStatus,
        adminNote: ngoFacingNote,
      },
    });

    // 4b. On approval, record per-document compliance verification + audit trail.
    // The core docs (Registration, PAN, 80G) were all reviewed together, so they're
    // marked verified now. 12A only counts if a 12A document was actually supplied.
    // FCRA has its own lifecycle and is approved separately in the FCRA review queue.
    if (action === "APPROVE") {
      try {
        const now = new Date();
        const has12A = !!ngo.compliance?.a12DocumentUrl;
        const compliance = await prisma.nGOCompliance.upsert({
          where: { ngoId },
          update: {
            panVerified: true,
            panVerifiedAt: now,
            registrationVerified: true,
            registrationVerifiedAt: now,
            eightyGVerified: true,
            eightyGVerifiedAt: now,
            ...(has12A ? { a12Verified: true, a12VerifiedAt: now } : {}),
            verifiedById: adminId,
          },
          create: {
            ngoId,
            panVerified: true,
            panVerifiedAt: now,
            registrationVerified: true,
            registrationVerifiedAt: now,
            eightyGVerified: true,
            eightyGVerifiedAt: now,
            verifiedById: adminId,
          },
        });

        const { logComplianceEvent } = await import("@/lib/ngo-compliance");
        await logComplianceEvent(compliance.id, "REGISTRATION_VERIFIED", "Registration certificate verified.", adminId);
        await logComplianceEvent(compliance.id, "PAN_VERIFIED", "PAN verified.", adminId);
        await logComplianceEvent(compliance.id, "80G_VERIFIED", "80G certificate verified.", adminId);
        if (has12A) {
          await logComplianceEvent(compliance.id, "12A_VERIFIED", "12A certificate verified.", adminId);
        }
      } catch (complianceErr) {
        console.error("Failed to record compliance verification:", complianceErr);
        // Non-fatal: the NGO is still approved.
      }
    }

    // 5. Send notification email to NGO owner
    if (action === "APPROVE") {
      await sendNGOApprovalEmail(ngo.user.email, ngo.orgName);
    } else {
      await sendNGORejectionEmail(ngo.user.email, ngo.orgName, ngoFacingNote);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("NGO Verification Error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
