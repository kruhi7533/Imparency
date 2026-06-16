import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

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

    // Mark as resolved and save notes
    await prisma.fraudAlert.update({
      where: { id: alertId },
      data: {
        resolved: true,
        resolutionNote: resolutionNote.trim()
      }
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
