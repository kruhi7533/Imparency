import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { deriveFcraStatus, logComplianceEvent } from "@/lib/ngo-compliance";
import {
  sendFcraApprovalEmail,
  sendFcraRejectionEmail,
  sendFcraReuploadEmail,
} from "@/lib/email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const body = await request.json();
    const {
      ngoId,
      action,
      adminNote,
      // APPROVE-only fields (admin-confirmed, pre-filled from extraction):
      fcraNumber,
      issueDate,
      expiryDate,
      authority,
      registeredSince,
    } = body;

    if (!ngoId || !["APPROVE", "REJECT", "REUPLOAD"].includes(action)) {
      return NextResponse.json({ error: "Missing or invalid action" }, { status: 400 });
    }
    if ((action === "REJECT" || action === "REUPLOAD") && (!adminNote || !adminNote.trim())) {
      return NextResponse.json({ error: "A note is required for this action" }, { status: 400 });
    }
    if (action === "APPROVE" && !expiryDate) {
      return NextResponse.json({ error: "An expiry date is required to approve FCRA" }, { status: 400 });
    }

    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      include: {
        user: { select: { email: true } },
        compliance: { select: { id: true } },
      },
    });
    if (!ngo || !ngo.compliance) {
      return NextResponse.json({ error: "NGO or compliance record not found" }, { status: 404 });
    }
    const complianceId = ngo.compliance.id;

    if (action === "APPROVE") {
      const expiry = new Date(expiryDate);
      const status = deriveFcraStatus(expiry) ?? "ACTIVE";
      await prisma.nGOCompliance.update({
        where: { id: complianceId },
        data: {
          fcraStatus: status,
          fcraNumber: fcraNumber ?? undefined,
          fcraIssueDate: issueDate ? new Date(issueDate) : undefined,
          fcraExpiryDate: expiry,
          fcraAuthority: authority ?? undefined,
          fcraRegisteredSince:
            registeredSince != null && registeredSince !== "" ? Number(registeredSince) : undefined,
          fcraVerifiedAt: new Date(),
          fcraAdminNote: null,
          verifiedById: adminId,
        },
      });
      await logComplianceEvent(
        complianceId,
        "FCRA_APPROVED",
        `FCRA verified — valid until ${expiry.toLocaleDateString("en-IN")}.`,
        adminId
      );
      await sendFcraApprovalEmail(ngo.user.email, ngo.orgName);
      return NextResponse.json({ success: true, fcraStatus: status });
    }

    // REJECT / REUPLOAD
    const newStatus = action === "REJECT" ? "REJECTED" : "REUPLOAD_REQUESTED";
    await prisma.nGOCompliance.update({
      where: { id: complianceId },
      data: {
        fcraStatus: newStatus,
        fcraAdminNote: adminNote.trim(),
        verifiedById: adminId,
      },
    });
    await logComplianceEvent(
      complianceId,
      action === "REJECT" ? "FCRA_REJECTED" : "FCRA_REUPLOAD_REQUESTED",
      adminNote.trim(),
      adminId
    );

    if (action === "REJECT") {
      await sendFcraRejectionEmail(ngo.user.email, ngo.orgName, adminNote.trim());
    } else {
      await sendFcraReuploadEmail(ngo.user.email, ngo.orgName, adminNote.trim());
    }

    return NextResponse.json({ success: true, fcraStatus: newStatus });
  } catch (err: any) {
    console.error("FCRA review error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
