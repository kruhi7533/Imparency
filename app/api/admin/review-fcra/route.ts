import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role, FCRAStatus } from "@prisma/client";
import { deriveFcraStatus, logComplianceEvent } from "@/lib/ngo-compliance";
import {
  sendFcraApprovalEmail,
  sendFcraRejectionEmail,
  sendFcraReuploadEmail,
} from "@/lib/email";
import { logAdminAction } from "@/lib/admin-log";

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
    if (action === "APPROVE" && new Date(expiryDate) <= new Date()) {
      return NextResponse.json({ error: "Cannot approve an already-expired FCRA certificate. Reject or request re-upload instead." }, { status: 400 });
    }

    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: ngoId },
      include: {
        user: { select: { email: true } },
        compliance: { select: { id: true, fcraStatus: true } },
      },
    });
    if (!ngo || !ngo.compliance) {
      return NextResponse.json({ error: "NGO or compliance record not found" }, { status: 404 });
    }
    const complianceId = ngo.compliance.id;
    const previousFcraStatus = ngo.compliance.fcraStatus;

    // State guard: only a submission actually awaiting a decision can be acted
    // on — mirrors the guard in verify-ngo/review-proof. Without this, this
    // route accepted an action against any fcraStatus (including re-approving
    // an already-ACTIVE or already-REJECTED record).
    const REVIEWABLE_STATUSES: FCRAStatus[] = [FCRAStatus.PENDING, FCRAStatus.REUPLOAD_REQUESTED];
    if (!REVIEWABLE_STATUSES.includes(previousFcraStatus)) {
      return NextResponse.json(
        { error: `FCRA submission is not awaiting review (current status: ${previousFcraStatus}).` },
        { status: 409 }
      );
    }

    if (action === "APPROVE") {
      const expiry = new Date(expiryDate);
      const status = deriveFcraStatus(expiry) ?? "ACTIVE";
      // Conditioned on the status still being reviewable — closes the race
      // window between the findUnique above and this write (two admins acting
      // on the same submission at once must not both succeed).
      const { count } = await prisma.nGOCompliance.updateMany({
        where: { id: complianceId, fcraStatus: { in: REVIEWABLE_STATUSES } },
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
      if (count === 0) {
        return NextResponse.json(
          { error: "FCRA submission was just decided by another admin action. Refresh and check its current status." },
          { status: 409 }
        );
      }
      await logComplianceEvent(
        complianceId,
        "FCRA_APPROVED",
        `FCRA verified — valid until ${expiry.toLocaleDateString("en-IN")}.`,
        adminId
      );
      await logAdminAction({
        adminId,
        action: "FCRA_APPROVED",
        entityType: "FCRA",
        entityId: ngoId,
        oldValue: { fcraStatus: previousFcraStatus },
        newValue: { fcraStatus: status, fcraExpiryDate: expiry.toISOString() },
        note: adminNote?.trim() || null,
        request,
      });
      await sendFcraApprovalEmail(ngo.user.email, ngo.orgName);
      return NextResponse.json({ success: true, fcraStatus: status });
    }

    // REJECT / REUPLOAD — same race guard as APPROVE above.
    const newStatus = action === "REJECT" ? "REJECTED" : "REUPLOAD_REQUESTED";
    const { count: rejectCount } = await prisma.nGOCompliance.updateMany({
      where: { id: complianceId, fcraStatus: { in: REVIEWABLE_STATUSES } },
      data: {
        fcraStatus: newStatus,
        fcraAdminNote: adminNote.trim(),
        verifiedById: adminId,
      },
    });
    if (rejectCount === 0) {
      return NextResponse.json(
        { error: "FCRA submission was just decided by another admin action. Refresh and check its current status." },
        { status: 409 }
      );
    }
    await logComplianceEvent(
      complianceId,
      action === "REJECT" ? "FCRA_REJECTED" : "FCRA_REUPLOAD_REQUESTED",
      adminNote.trim(),
      adminId
    );

    await logAdminAction({
      adminId,
      action: action === "REJECT" ? "FCRA_REJECTED" : "FCRA_REUPLOAD_REQUESTED",
      entityType: "FCRA",
      entityId: ngoId,
      oldValue: { fcraStatus: previousFcraStatus },
      newValue: { fcraStatus: newStatus },
      note: adminNote.trim(),
      request,
    });

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
