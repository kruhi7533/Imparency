import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { logAdminAction } from "@/lib/admin-log";
import { logDonorEvent } from "@/lib/donor-events";
import { assessFunderOrg } from "@/lib/csr-verification";

export const runtime = "nodejs";

/**
 * ADMIN-only. The human gate on a donor ORGANISATION.
 *
 * `pan-review` next door answers "is this person's tax id real". This answers
 * a different question — "is the company behind the money real" — and it is the
 * one an NGO is implicitly trusting when it receives a shortlist email carrying
 * this platform's name. Until now only the first question had an answer, and
 * lib/matching/funder.ts said so in as many words.
 *
 * This route is the ONLY thing that writes VERIFIED. The donor's own profile
 * save can move a profile to PENDING and can retire an approval, but it can
 * never grant one — the same separation as ExtractedField, where only a human
 * PATCH produces VALIDATED.
 *
 * Body: { action: "VERIFY" | "REJECT", note: string }
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { action, note } = body;

    if (!["VERIFY", "REJECT"].includes(action)) {
      return NextResponse.json({ error: "action must be VERIFY or REJECT" }, { status: 400 });
    }
    if (!note?.trim()) {
      return NextResponse.json(
        { error: "A written note is required — an organisation decision must be justified." },
        { status: 400 }
      );
    }

    const donor = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        role: true,
        isCorporate: true,
        companyName: true,
        cin: true,
        csrBudget: true,
        donorPersona: true,
        trustRegistrationId: true,
        trustAnnualBudget: true,
        orgVerificationStatus: true,
      },
    });
    if (!donor || donor.role !== "DONOR") {
      return NextResponse.json({ error: "Donor not found" }, { status: 404 });
    }

    // Only a profile actually awaiting review can be decided. Without this an
    // already-VERIFIED organisation could be re-approved, re-firing the donor
    // notification and overwriting the note that explained the first decision.
    // Mirrors review-proof, review-project and verify-ngo.
    if (donor.orgVerificationStatus !== "PENDING") {
      return NextResponse.json(
        {
          error:
            donor.orgVerificationStatus === "NOT_SUBMITTED"
              ? "This donor has not submitted an organisation profile, so there is nothing to review."
              : `This organisation is not awaiting review (current status: ${donor.orgVerificationStatus}).`,
        },
        { status: 409 }
      );
    }

    // ─── The front gate ──────────────────────────────────────────────────
    //
    // An incomplete profile cannot be approved, and no note gets typed through
    // it. A note is the right shape for a judgement call — "I checked the
    // filings and I am satisfied" — and the wrong shape for a missing CIN,
    // because there is simply nothing there to have judged.
    //
    // Deliberately re-run here rather than trusted from the PENDING status:
    // the status was computed at profile-save time, and the profile can have
    // been edited since.
    if (action === "VERIFY") {
      const assessment = assessFunderOrg({
        donorPersona: donor.donorPersona,
        orgName: donor.companyName,
        cin: donor.cin,
        csrBudget: donor.csrBudget == null ? null : Number(donor.csrBudget),
        trustRegistrationId: donor.trustRegistrationId,
        trustAnnualBudget: donor.trustAnnualBudget == null ? null : Number(donor.trustAnnualBudget),
      });
      if (!assessment.complete) {
        return NextResponse.json(
          {
            error: `This organisation's profile is missing ${assessment.missing.join(", ")}. Ask the donor to complete it before approving — this cannot be approved with a note.`,
            missing: assessment.missing,
          },
          { status: 400 }
        );
      }
    }

    const adminId = auth.session.user.id;
    const noteText = note.trim();
    const oldState = { orgVerificationStatus: donor.orgVerificationStatus };
    const newStatus = action === "VERIFY" ? "VERIFIED" : "REJECTED";

    // Compare-and-swap on the status we read, so two admins deciding the same
    // organisation at once cannot both win — the loser gets a 409 rather than
    // silently overwriting a decision that was already taken.
    const { count } = await prisma.user.updateMany({
      where: { id: donor.id, orgVerificationStatus: "PENDING" },
      data: {
        orgVerificationStatus: newStatus,
        orgVerifiedAt: action === "VERIFY" ? new Date() : null,
        orgVerifiedById: adminId,
        orgVerificationNote: noteText,
      },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "This organisation was just decided by another admin action. Refresh and check its current status." },
        { status: 409 }
      );
    }

    const newState = { orgVerificationStatus: newStatus };

    await logAdminAction({
      adminId,
      action: action === "VERIFY" ? "CSR_ORG_VERIFIED" : "CSR_ORG_REJECTED",
      entityType: "DONOR",
      entityId: donor.id,
      oldValue: oldState,
      newValue: newState,
      note: noteText,
      request,
    });

    await logDonorEvent({
      donorId: donor.id,
      eventType: action === "VERIFY" ? "CSR_ORG_VERIFIED" : "CSR_ORG_REJECTED",
      oldValue: oldState,
      newValue: newState,
      initiatedBy: adminId,
      source: "ADMIN",
    });

    await prisma.notification.create({
      data: {
        userId: donor.id,
        type: action === "VERIFY" ? "CSR_ORG_VERIFIED" : "CSR_ORG_REJECTED",
        title:
          action === "VERIFY"
            ? "Your organisation has been verified"
            : "Your organisation could not be verified",
        body:
          action === "VERIFY"
            ? "Our team verified your organisation's details. You can now be named as the funder behind an opportunity."
            : `Our team could not verify your organisation: ${noteText}. Update your profile and it will return for review.`,
      },
    });

    return NextResponse.json({ success: true, action, orgVerificationStatus: newStatus });
  } catch (err: any) {
    console.error("Organisation review error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
