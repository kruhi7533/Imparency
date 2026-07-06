import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const { alertId, resolutionNote } = body;

    if (!alertId || !resolutionNote || !resolutionNote.trim()) {
      return NextResponse.json(
        { error: "Alert ID and a written resolution note are required" },
        { status: 400 }
      );
    }

    const alert = await prisma.fraudAlert.findUnique({
      where: { id: alertId }
    });

    if (!alert) {
      return NextResponse.json({ error: "Fraud alert not found" }, { status: 404 });
    }

    // State guard — a resolved alert must not be silently re-resolved (the
    // original resolver's attribution would be overwritten).
    if (alert.resolved) {
      return NextResponse.json(
        { error: "This alert has already been resolved." },
        { status: 409 }
      );
    }

    const adminId = auth.session.user.id;

    // Mark as resolved with full attribution
    await prisma.fraudAlert.update({
      where: { id: alertId },
      data: {
        resolved: true,
        resolutionNote: resolutionNote.trim(),
        resolvedById: adminId,
        resolvedAt: new Date(),
      }
    });

    await logAdminAction({
      adminId,
      action: "ALERT_RESOLVED",
      entityType: "FRAUD_ALERT",
      entityId: alertId,
      oldValue: { resolved: false },
      newValue: { resolved: true },
      note: resolutionNote.trim(),
      metadata: {
        alertType: alert.type,
        severity: alert.severity,
        targetEntityType: alert.entityType,
        targetEntityId: alert.entityId,
      },
      request,
    });

    return NextResponse.json({
      success: true,
      message: "Fraud alert resolved successfully."
    });
  } catch (error: any) {
    console.error("Error resolving fraud alert:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
