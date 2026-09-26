import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { FLAG_EVIDENCE_FIELD, ComplianceFlag } from "@/lib/compliance-evidence";
import { FIELD_LABELS } from "@/lib/gemini/extract-ngo-fields";

export const runtime = "nodejs";

/** Reverse of FLAG_EVIDENCE_FIELD: which flag (if any) this field is evidence for. */
const FLAG_FOR_FIELD: Record<string, ComplianceFlag> = Object.entries(
  FLAG_EVIDENCE_FIELD
).reduce((acc, [flag, fieldKey]) => {
  acc[fieldKey] = flag as ComplianceFlag;
  return acc;
}, {} as Record<string, ComplianceFlag>);

const VERIFIED_AT_COLUMN: Record<ComplianceFlag, string> = {
  panVerified: "panVerifiedAt",
  registrationVerified: "registrationVerifiedAt",
  a12Verified: "a12VerifiedAt",
  eightyGVerified: "eightyGVerifiedAt",
};

const COMPLIANCE_EVENT: Record<ComplianceFlag, string> = {
  panVerified: "PAN_VERIFIED",
  registrationVerified: "REGISTRATION_VERIFIED",
  a12Verified: "12A_VERIFIED",
  eightyGVerified: "80G_VERIFIED",
};

/**
 * ADMIN-only. The human gate: validate or reject one extracted field.
 *
 * A field only becomes VALIDATED here, and only a VALIDATED field can earn its
 * NGOCompliance flag at approval time (lib/compliance-evidence.ts). The admin
 * may correct the value rather than accept it — the correction is stored in
 * validatedValue, leaving the agent's original extractedValue intact so the
 * two can be compared later.
 *
 * If the NGO is already VERIFIED, the flag is applied (or revoked) immediately,
 * since there is no future approval step left to apply it.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { fieldId: string } }
) {
  const { authorized, response, session } = await verifySessionRole("ADMIN");
  if (!authorized) return response;
  const adminId = session.user.id;

  try {
    const { action, correctedValue, note } = await request.json();

    if (!["VALIDATE", "REJECT"].includes(action)) {
      return NextResponse.json(
        { error: "action must be VALIDATE or REJECT" },
        { status: 400 }
      );
    }

    const field = await prisma.extractedField.findUnique({
      where: { id: params.fieldId },
      include: {
        ngo: {
          select: {
            id: true,
            orgName: true,
            verificationStatus: true,
            compliance: { select: { id: true } },
          },
        },
      },
    });

    if (!field) {
      return NextResponse.json({ error: "Field not found" }, { status: 404 });
    }

    // A field with no extracted value can still be VALIDATED, but only if the
    // admin supplies the value themselves — otherwise "validated" would mean
    // "confirmed nothing", which must not earn a compliance flag.
    const finalValue =
      typeof correctedValue === "string" && correctedValue.trim()
        ? correctedValue.trim()
        : null;

    if (action === "VALIDATE" && !field.extractedValue && !finalValue) {
      return NextResponse.json(
        {
          error:
            "This field has no extracted value. Enter the correct value to validate it, or reject it.",
        },
        { status: 400 }
      );
    }

    const updated = await prisma.extractedField.update({
      where: { id: params.fieldId },
      data: {
        status: action === "VALIDATE" ? "VALIDATED" : "REJECTED",
        validatedValue: finalValue,
        validatedById: adminId,
        validatedAt: new Date(),
      },
    });

    // Apply the compliance consequence immediately for already-verified NGOs.
    const flag = FLAG_FOR_FIELD[field.fieldKey];
    let flagApplied: { flag: ComplianceFlag; value: boolean } | null = null;

    if (flag && field.ngo.verificationStatus === "VERIFIED" && field.ngo.compliance?.id) {
      try {
        const value = action === "VALIDATE";
        await prisma.nGOCompliance.update({
          where: { id: field.ngo.compliance.id },
          data: {
            [flag]: value,
            [VERIFIED_AT_COLUMN[flag]]: value ? new Date() : null,
            verifiedById: adminId,
          } as any,
        });

        const { logComplianceEvent } = await import("@/lib/ngo-compliance");
        await logComplianceEvent(
          field.ngo.compliance.id,
          value ? COMPLIANCE_EVENT[flag] : `${COMPLIANCE_EVENT[flag]}_REVOKED`,
          value
            ? `${FIELD_LABELS[field.fieldKey] || field.fieldKey} validated against the uploaded document.`
            : `${FIELD_LABELS[field.fieldKey] || field.fieldKey} evidence rejected by an admin.`,
          adminId
        );
        flagApplied = { flag, value };
      } catch (complianceErr) {
        // Non-fatal: the field decision stands. Surfaced so the drift between
        // the field record and the compliance flag is visible.
        console.error(
          `[ngo-fields] failed to apply ${flag} for NGO ${field.ngo.id}:`,
          complianceErr
        );
      }
    }

    await logAdminAction({
      adminId,
      action: action === "VALIDATE" ? "NGO_FIELD_VALIDATED" : "NGO_FIELD_REJECTED",
      entityType: "NGO",
      entityId: field.ngo.id,
      oldValue: { fieldKey: field.fieldKey, status: field.status },
      newValue: { fieldKey: field.fieldKey, status: updated.status },
      note: note || null,
      metadata: {
        ai: {
          extractedValue: field.extractedValue,
          confidence: field.confidence,
          matchesSubmitted: field.matchesSubmitted,
        },
        correctedValue: finalValue,
        // True when the admin typed something different from what the agent read.
        overrodeAi: !!finalValue && finalValue !== field.extractedValue,
        ...(flagApplied ? { complianceFlagApplied: flagApplied } : {}),
      },
      request,
    });

    return NextResponse.json({ field: updated, flagApplied });
  } catch (err: any) {
    console.error("NGO field validation error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
