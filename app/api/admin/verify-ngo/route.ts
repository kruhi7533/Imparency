import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { sendNGOApprovalEmail, sendNGORejectionEmail } from "@/lib/email";

export async function POST(request: Request) {
  try {
    // 1. Guard check: only Admin users can verify NGOs
    const { authorized, response } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

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
