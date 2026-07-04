import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { logAdminAction } from "@/lib/admin-log";
import { logDonorEvent } from "@/lib/donor-events";
import { issueTaxReceipt } from "@/lib/tax-receipt";

export const runtime = "nodejs";

/**
 * Manual PAN resolution — activates the MANUAL_ADMIN verification path.
 * Used when the provider failed (PROVIDER_ERROR), a name mismatch needs human
 * judgment, or a MOCK-mode verification needs to be confirmed for real.
 *
 * Body: { action: "VERIFY" | "REJECT", note: string }
 * VERIFY additionally issues any 80G receipts that were withheld pending PAN.
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
        { error: "A written note is required — manual PAN decisions must be justified." },
        { status: 400 }
      );
    }

    const donor = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        role: true,
        name: true,
        panNumber: true,
        panStatus: true,
        panVerifiedVia: true,
      },
    });
    if (!donor || donor.role !== "DONOR") {
      return NextResponse.json({ error: "Donor not found" }, { status: 404 });
    }
    if (!donor.panNumber) {
      return NextResponse.json(
        { error: "This donor has no PAN on file — nothing to review." },
        { status: 400 }
      );
    }

    const adminId = auth.session.user.id;
    const noteText = note.trim();
    const oldState = { panStatus: donor.panStatus, panVerifiedVia: donor.panVerifiedVia };

    if (action === "VERIFY") {
      await prisma.user.update({
        where: { id: donor.id },
        data: {
          panStatus: "VERIFIED",
          panVerifiedAt: new Date(),
          panVerifiedVia: "MANUAL_ADMIN",
        },
      });
    } else {
      await prisma.user.update({
        where: { id: donor.id },
        data: {
          panStatus: "FAILED",
          panVerifiedAt: null,
          panVerifiedVia: null,
        },
      });
    }

    const newState =
      action === "VERIFY"
        ? { panStatus: "VERIFIED", panVerifiedVia: "MANUAL_ADMIN" }
        : { panStatus: "FAILED", panVerifiedVia: null };

    await logAdminAction({
      adminId,
      action: action === "VERIFY" ? "PAN_MANUALLY_VERIFIED" : "PAN_MANUALLY_REJECTED",
      entityType: "DONOR",
      entityId: donor.id,
      oldValue: oldState,
      newValue: newState,
      note: noteText,
      request,
    });

    await logDonorEvent({
      donorId: donor.id,
      eventType: action === "VERIFY" ? "PAN_MANUALLY_VERIFIED" : "PAN_MANUALLY_REJECTED",
      oldValue: oldState,
      newValue: newState,
      initiatedBy: adminId,
      source: "ADMIN",
    });

    await prisma.notification.create({
      data: {
        userId: donor.id,
        type: action === "VERIFY" ? "PAN_VERIFIED_BY_ADMIN" : "PAN_REJECTED_BY_ADMIN",
        title: action === "VERIFY" ? "Your PAN has been verified" : "Your PAN could not be verified",
        body:
          action === "VERIFY"
            ? "Our team manually verified your PAN. Any pending 80G tax receipts are being generated now."
            : `Our team could not verify your PAN: ${noteText}. Please update it in your profile.`,
      },
    });

    // On VERIFY, release the 80G receipts that were withheld pending PAN.
    let receiptsIssued = 0;
    if (action === "VERIFY") {
      const pending = await prisma.donation.findMany({
        where: { donorId: donor.id, status: "SUCCESS", taxReceipt: null },
        select: { id: true },
      });
      for (const d of pending) {
        try {
          await issueTaxReceipt(d.id, { trigger: "ADMIN", actorId: adminId }); // idempotent
          receiptsIssued++;
        } catch (err) {
          console.error(`Manual-verify receipt issuance failed for donation ${d.id}:`, err);
        }
      }
    }

    return NextResponse.json({ success: true, action, receiptsIssued });
  } catch (err: any) {
    console.error("PAN review error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
