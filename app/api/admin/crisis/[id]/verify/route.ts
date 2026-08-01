import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";

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

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    // State guard mirrors verify-ngo: only PENDING events can be decided, and the
    // updateMany condition closes the read/write race a plain findUnique+update leaves open.
    if (event.verificationStatus !== "PENDING") {
      return NextResponse.json(
        { error: `This event is not awaiting verification (current status: ${event.verificationStatus}).` },
        { status: 409 }
      );
    }

    const { count } = await prisma.crisisEvent.updateMany({
      where: { id: params.id, verificationStatus: "PENDING" },
      data: {
        verificationStatus: decision,
        verifiedById: adminId,
        verifiedAt: new Date(),
      },
    });

    if (count === 0) {
      return NextResponse.json(
        { error: "This event was just decided by another admin action. Refresh and check its current status." },
        { status: 409 }
      );
    }

    await logAdminAction({
      adminId,
      action: decision === "VERIFIED" ? "CRISIS_EVENT_VERIFIED" : "CRISIS_EVENT_REJECTED",
      entityType: "CRISIS_EVENT",
      entityId: event.id,
      oldValue: { verificationStatus: "PENDING" },
      newValue: { verificationStatus: decision },
      note: note?.trim() || null,
      request,
    });

    return NextResponse.json({ id: event.id, verificationStatus: decision });
  } catch (err: any) {
    console.error("Crisis Event verify error:", err);
    return NextResponse.json({ error: "We couldn't process this verification right now." }, { status: 500 });
  }
}
