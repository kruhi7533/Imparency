import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { sendInitiativeVerifiedEmail, sendInitiativeRejectedEmail } from "@/lib/email";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("ADMIN");
    if (!authorized) return response;
    const adminId = session.user.id;

    const { decision, note } = await request.json();
    if (!decision || !["VERIFIED", "REJECTED"].includes(decision)) {
      return NextResponse.json({ error: "decision must be VERIFIED or REJECTED" }, { status: 400 });
    }
    if (decision === "REJECTED" && !note?.trim()) {
      return NextResponse.json({ error: "A rejection note is required" }, { status: 400 });
    }

    const initiative = await prisma.reliefInitiative.findUnique({
      where: { id: params.id },
      include: { submittedBy: { select: { email: true, name: true } } },
    });
    if (!initiative) return NextResponse.json({ error: "Initiative not found" }, { status: 404 });

    if (!["SUBMITTED", "UNDER_REVIEW"].includes(initiative.status)) {
      return NextResponse.json(
        { error: `This initiative is not awaiting verification (current status: ${initiative.status}).` },
        { status: 409 }
      );
    }

    const newStatus = decision === "VERIFIED" ? "PUBLISHED" : "REJECTED";

    const { count } = await prisma.reliefInitiative.updateMany({
      where: { id: params.id, status: initiative.status },
      data: {
        status: newStatus,
        reviewNote: note?.trim() || null,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "This initiative was just decided by another admin action. Refresh and check its current status." },
        { status: 409 }
      );
    }

    await logAdminAction({
      adminId,
      action: decision === "VERIFIED" ? "INITIATIVE_VERIFIED" : "INITIATIVE_REJECTED",
      entityType: "RELIEF_INITIATIVE",
      entityId: initiative.id,
      oldValue: { status: initiative.status },
      newValue: { status: newStatus },
      note: note?.trim() || null,
      request,
    });

    if (decision === "VERIFIED") {
      await sendInitiativeVerifiedEmail(initiative.submittedBy.email, initiative.submittedBy.name, initiative.organizerName);
    } else {
      await sendInitiativeRejectedEmail(initiative.submittedBy.email, initiative.submittedBy.name, initiative.organizerName, note.trim());
    }

    return NextResponse.json({ id: initiative.id, status: newStatus });
  } catch (err: any) {
    console.error("Initiative verify error:", err);
    return NextResponse.json({ error: "We couldn't process this verification right now." }, { status: 500 });
  }
}
