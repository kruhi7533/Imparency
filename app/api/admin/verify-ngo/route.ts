import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { sendNGOApprovalEmail, sendNGORejectionEmail } from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";
import { captureError } from "@/lib/observability";

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
        riskReviews: {
          where: { status: "OPEN" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { riskLevel: true, findings: true },
        },
        compliance: { select: { id: true, a12DocumentUrl: true } },
      },
    });

    if (!ngo) {
      return NextResponse.json({ error: "NGO Profile not found" }, { status: 404 });
    }

    // Two ways an NGO can legitimately be decided here:
    //
    //   1. PENDING — the ordinary first decision.
    //   2. VERIFIED with reverificationRequiredAt set — evidence gathered after
    //      approval contradicted it, so the decision came back. Deliberately
    //      routed through THIS handler rather than a parallel "re-verify" route:
    //      a re-decision is the same decision, and giving it its own code path
    //      would mean two audit shapes, two sets of gates, and two places to
    //      forget something.
    //
    // Anything else is double-processing and is refused, as before.
    const isRedecision = ngo.verificationStatus === "VERIFIED" && !!ngo.reverificationRequiredAt;
    if (ngo.verificationStatus !== "PENDING" && !isRedecision) {
      return NextResponse.json(
        { error: `NGO is not awaiting verification (current status: ${ngo.verificationStatus}).` },
        { status: 409 }
      );
    }

    // ─── The front gate ──────────────────────────────────────────────────
    //
    // Three conditions that BLOCK an approval outright. Everything else in this
    // route is friction — "type a note and continue" — which is the right shape
    // for a judgement call and the wrong shape for these. Friction gets typed
    // through: three organisations reached VERIFIED with no readable evidence
    // between them, and the note gate did not stop any of them.
    //
    // These are not judgement calls:
    //   1. No documents at all. There is nothing to approve ON.
    //   2. Documents nobody has read. The evidence exists but is unexamined,
    //      so an approval would rest on a file listing, not on its contents.
    //   3. A document contradicting the form about WHO this is. A missing 80G
    //      is an everyday approval; a PAN that disagrees with the PAN on the
    //      form is a different question, and one text box treated them the same.
    //
    // Each has a way out that fixes the evidence rather than talks past it.
    if (action === "APPROVE") {
      if ((ngo.documents ?? []).length === 0) {
        return NextResponse.json(
          {
            error:
              "This organisation has not uploaded any documents. There is nothing to verify — ask them to submit their registration documents before approving.",
          },
          { status: 400 }
        );
      }

      const extractedCount = await prisma.extractedField.count({ where: { ngoId } });
      if (extractedCount === 0) {
        return NextResponse.json(
          {
            error:
              "This organisation's documents have never been analysed, so there is no evidence to approve on. Run extraction from Document Review first.",
          },
          { status: 400 }
        );
      }

      const identityFields = new Set(["orgName", "panNumber", "registrationNumber"]);
      // Read straight off the loaded NGO: `openRisk` is derived a few lines
      // below, and this gate has to run before any of the note-based checks.
      const openFindings = Array.isArray(ngo.riskReviews?.[0]?.findings)
        ? (ngo.riskReviews[0].findings as any[])
        : [];
      const identityConflict = openFindings.filter(
        (f) => f?.severity === "HIGH" && typeof f?.fieldKey === "string" && identityFields.has(f.fieldKey)
      );
      if (identityConflict.length > 0) {
        return NextResponse.json(
          {
            error: `The documents contradict the registration form on ${identityConflict
              .map((f) => f.fieldKey)
              .join(", ")}. This cannot be approved with a note — it is a question of whether this is the same organisation. Correct or validate the field in Document Review, or reject.`,
          },
          { status: 400 }
        );
      }
    }

    // Re-affirming an approval whose evidence has failed is exactly the moment
    // that most needs a written reason on the record.
    if (isRedecision && action === "APPROVE" && (!adminNote || !adminNote.trim())) {
      return NextResponse.json(
        { error: "A note is required to re-approve an organisation whose document evidence has failed." },
        { status: 400 }
      );
    }

    // Snapshot the automated verdict at decision time — analysis can be re-run
    // later, so the log must capture what the admin actually saw.
    const openRisk = ngo.riskReviews?.[0] ?? null;
    const aiRecommendation: string | null = openRisk
      ? `NEEDS_RISK_REVIEW:${openRisk.riskLevel}`
      : "SAFE";
    const aiSaysProblematic = !!openRisk;
    const overrodeAi =
      (action === "APPROVE" && aiSaysProblematic) ||
      (action === "REJECT" && !aiSaysProblematic);

    // Server-side friction: approving against a negative AI recommendation
    // requires a written disagreement reason (extends the LIKELY_FRAUD rule).
    if (action === "APPROVE" && aiSaysProblematic && (!adminNote || !adminNote.trim())) {
      return NextResponse.json(
        { error: `Justification note is required to approve against the AI recommendation (${aiRecommendation}).` },
        { status: 400 }
      );
    }

    // Field-level evidence: which compliance flags this approval has earned,
    // and which extracted fields are still awaiting review. Best-effort — an
    // evidence-query failure must not block a decision, but it does mean no
    // flag can be earned, which is the safe direction to fail in.
    let evidence = {
      earned: {
        panVerified: false,
        registrationVerified: false,
        a12Verified: false,
        eightyGVerified: false,
      },
      outstanding: [] as string[],
      noExtraction: true,
    };
    try {
      const { getComplianceEvidence } = await import("@/lib/compliance-evidence");
      evidence = await getComplianceEvidence(ngoId);
    } catch (evidenceErr) {
      captureError(
        evidenceErr,
        { scope: "admin/verify-ngo", operation: "load_compliance_evidence", entityType: "NGO", entityId: ngoId, userId: adminId },
        "warning"
      );
    }

    // The human gate. Approving while extracted fields are still unreviewed is
    // allowed — an NGO can be legitimately approved with an unverifiable 80G —
    // but it must be a deliberate, written decision rather than a default.
    if (action === "APPROVE" && evidence.outstanding.length > 0 && (!adminNote || !adminNote.trim())) {
      return NextResponse.json(
        {
          error: `${evidence.outstanding.length} extracted field(s) are still awaiting review (${evidence.outstanding.join(", ")}). Review them in Document Review, or add a note explaining why you are approving without them.`,
        },
        { status: 400 }
      );
    }

    const noteText = adminNote ? adminNote.trim() : "All documents verified successfully.";

    // On rejection, turn the terse admin note + AI flags into clear, actionable
    // guidance the NGO can act on. Degrades to the raw note on any failure.
    let ngoFacingNote = noteText;
    if (action === "REJECT") {
      try {
        const { composeRejectionGuidance } = await import("@/lib/gemini/explain-rejection");
        const findings = Array.isArray(openRisk?.findings) ? (openRisk!.findings as any[]) : [];
        ngoFacingNote = await composeRejectionGuidance({
          orgName: ngo.orgName,
          adminNote: noteText,
          aiSummary: null,
          flags: findings,
        });
      } catch (guidanceErr) {
        // Degrades to the raw admin note — the NGO still gets a reason, just a
        // terser one. Worth knowing about if the AI path is failing constantly.
        captureError(
          guidanceErr,
          {
            scope: "admin/verify-ngo",
            operation: "compose_rejection_guidance",
            entityType: "NGO",
            entityId: ngoId,
            userId: adminId,
          },
          "warning"
        );
        ngoFacingNote = noteText;
      }
    }

    // 4. Update status in database — conditioned on the status still being
    // PENDING so a concurrent decision on the same NGO can't both go through
    // (the earlier findUnique check alone leaves a race window between read
    // and write).
    const updatedStatus = action === "APPROVE" ? "VERIFIED" : "REJECTED";
    const { count } = await prisma.nGOProfile.updateMany({
      // Conditioned on the status we read, so a concurrent decision on the same
      // NGO cannot also go through. For a re-decision that status is VERIFIED
      // and the reversal flag is the thing being consumed, so it is part of the
      // condition too — two admins re-deciding at once must not both win.
      where: isRedecision
        ? { id: ngoId, verificationStatus: "VERIFIED", reverificationRequiredAt: { not: null } }
        : { id: ngoId, verificationStatus: "PENDING" },
      data: {
        verificationStatus: updatedStatus,
        adminNote: ngoFacingNote,
        // The re-decision has now been made, whichever way it went.
        ...(isRedecision
          ? {
              reverificationRequiredAt: null,
              reverificationReason: null,
              reverificationDueAt: null,
              reverificationEscalatedAt: null,
            }
          : {}),
      },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "NGO was just decided by another admin action. Refresh and check its current status." },
        { status: 409 }
      );
    }

    // 4b. On approval, record per-document compliance verification + audit trail.
    // Each flag is set ONLY if an admin validated the field that evidences it
    // (lib/compliance-evidence.ts). Previously all three core flags were set to
    // true unconditionally and 12A on the mere existence of a document URL —
    // which meant "80G certificate verified." could be written to the audit log,
    // and 20 points added to the donor-facing compliance score, for an NGO that
    // never uploaded an 80G certificate. FCRA keeps its own lifecycle and is
    // approved separately in the FCRA review queue.
    if (action === "APPROVE") {
      try {
        const now = new Date();
        const earned = evidence.earned;
        const setFlag = (flag: keyof typeof earned, atColumn: string) =>
          earned[flag] ? { [flag]: true, [atColumn]: now } : {};

        const verifiedFlags = {
          ...setFlag("panVerified", "panVerifiedAt"),
          ...setFlag("registrationVerified", "registrationVerifiedAt"),
          ...setFlag("eightyGVerified", "eightyGVerifiedAt"),
          ...setFlag("a12Verified", "a12VerifiedAt"),
        };

        const compliance = await prisma.nGOCompliance.upsert({
          where: { ngoId },
          update: { ...verifiedFlags, verifiedById: adminId },
          create: { ngoId, ...verifiedFlags, verifiedById: adminId },
        });

        const { logComplianceEvent } = await import("@/lib/ngo-compliance");
        if (earned.registrationVerified) {
          await logComplianceEvent(compliance.id, "REGISTRATION_VERIFIED", "Registration number validated against the uploaded certificate.", adminId);
        }
        if (earned.panVerified) {
          await logComplianceEvent(compliance.id, "PAN_VERIFIED", "PAN validated against the uploaded PAN card.", adminId);
        }
        if (earned.eightyGVerified) {
          await logComplianceEvent(compliance.id, "80G_VERIFIED", "80G number validated against the uploaded certificate.", adminId);
        }
        if (earned.a12Verified) {
          await logComplianceEvent(compliance.id, "12A_VERIFIED", "12A number validated against the uploaded certificate.", adminId);
        }
      } catch (complianceErr) {
        // Non-fatal: the NGO is still approved. But its compliance record and
        // audit trail now disagree with that approval, which is exactly the
        // kind of drift a regulator would find rather than us.
        captureError(complianceErr, {
          scope: "admin/verify-ngo",
          operation: "record_compliance_verification",
          entityType: "NGO",
          entityId: ngoId,
          userId: adminId,
        });
      }
    }

    // 5. Audit trail — who decided, what changed, what the AI said at the time.
    await logAdminAction({
      adminId,
      action: action === "APPROVE" ? "NGO_APPROVED" : "NGO_REJECTED",
      entityType: "NGO",
      entityId: ngoId,
      oldValue: { verificationStatus: "PENDING" },
      newValue: { verificationStatus: updatedStatus },
      note: noteText,
      metadata: {
        ai: {
          recommendation: aiRecommendation,
          riskLevel: openRisk?.riskLevel ?? null,
          findingCount: Array.isArray(openRisk?.findings) ? (openRisk!.findings as any[]).length : 0,
        },
        overrodeAi,
        ...(overrodeAi ? { disagreementReason: noteText } : {}),
        // Which compliance flags this approval actually earned, and what was
        // still unreviewed at the moment of decision.
        evidence: {
          earnedFlags: Object.entries(evidence.earned)
            .filter(([, v]) => v)
            .map(([k]) => k),
          outstandingFields: evidence.outstanding,
          noExtraction: evidence.noExtraction,
        },
      },
      request,
    });

    // 6. Send notification email to NGO owner
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
