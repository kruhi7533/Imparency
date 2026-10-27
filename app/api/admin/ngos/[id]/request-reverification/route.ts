import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { REVERIFICATION_WINDOW_DAYS } from "@/lib/verification-reversal";

/**
 * POST /api/admin/ngos/[id]/request-reverification { reason, dueInDays? }
 *
 * ADM-004: an admin puts a VERIFIED organisation into "re-verification due".
 * Uses the same fields the platform's own reversal writes
 * (lib/verification-reversal.ts) — verificationStatus stays VERIFIED, the
 * approval is questioned not erased, and POST /api/admin/verify-ngo already
 * treats `reverificationRequiredAt` as a re-decision. Nothing is suspended.
 *
 * Idempotent: an NGO already due re-verification is returned unchanged (200,
 * alreadyDue) rather than having its clock restarted.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
    if (!authorized) return response;

    const body = await request.json().catch(() => null);
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    if (reason.length < 10) return NextResponse.json({ error: "Give a reason (at least 10 characters) — the NGO sees it." }, { status: 400 });
    const days = body?.dueInDays === undefined ? REVERIFICATION_WINDOW_DAYS : Number(body.dueInDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) return NextResponse.json({ error: "dueInDays must be a whole number from 1 to 90" }, { status: 400 });

    const ngo = await prisma.nGOProfile.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, verificationStatus: true, reverificationRequiredAt: true, reverificationDueAt: true, isDeleted: true },
    });
    if (!ngo || ngo.isDeleted) return NextResponse.json({ error: "NGO not found" }, { status: 404 });
    if (ngo.verificationStatus !== "VERIFIED") {
      return NextResponse.json({ error: `Only a VERIFIED organisation can be asked to re-verify; this one is ${ngo.verificationStatus}.` }, { status: 409 });
    }
    if (ngo.reverificationRequiredAt) {
      return NextResponse.json({ ok: true, alreadyDue: true, dueAt: ngo.reverificationDueAt?.toISOString() ?? null });
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const { count } = await prisma.nGOProfile.updateMany({
      where: { id: ngo.id, verificationStatus: "VERIFIED", reverificationRequiredAt: null },
      data: { reverificationRequiredAt: now, reverificationReason: reason, reverificationDueAt: dueAt, reverificationEscalatedAt: null },
    });
    if (count === 0) return NextResponse.json({ ok: true, alreadyDue: true });

    await logAdminAction({
      adminId: session.user.id,
      action: "NGO_REVERIFICATION_REQUESTED",
      entityType: "NGO",
      entityId: ngo.id,
      oldValue: { reverificationRequiredAt: null },
      newValue: { reverificationRequiredAt: now.toISOString(), dueAt: dueAt.toISOString() },
      // The reason lives on the NGO row (reverificationReason); the log records
      // that one was given, not its free text, which may name people.
      metadata: { reasonGiven: true, dueInDays: days },
      request,
    });

    try {
      await prisma.notification.create({
        data: {
          userId: ngo.userId,
          type: "REVERIFICATION_DUE",
          title: "Re-verification due",
          body: `ImpactBridge needs to re-verify your organisation by ${dueAt.toDateString()}. Open your dashboard for what to do.`,
        },
      });
    } catch (err) {
      console.error("[admin/request-reverification] notify failed for", ngo.id, err);
    }
    return NextResponse.json({ ok: true, dueAt: dueAt.toISOString() });
  } catch (error) {
    console.error("[api/admin/ngos/[id]/request-reverification] POST error:", error);
    return NextResponse.json({ error: "Failed to request re-verification" }, { status: 500 });
  }
}
