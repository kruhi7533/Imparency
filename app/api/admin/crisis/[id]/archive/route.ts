import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    if (event.status !== "CLOSED") {
      return NextResponse.json({ error: "Only a closed event can be archived" }, { status: 400 });
    }
    if (event.isArchived) {
      return NextResponse.json({ error: "This event is already archived" }, { status: 409 });
    }

    const updated = await prisma.crisisEvent.update({
      where: { id: params.id },
      data: { isArchived: true, isFeatured: false },
    });

    await logAdminAction({
      adminId: session.user.id,
      action: "CRISIS_EVENT_ARCHIVED",
      entityType: "CRISIS_EVENT",
      entityId: event.id,
      oldValue: { isArchived: false },
      newValue: { isArchived: true },
      request,
    });

    return NextResponse.json({ id: updated.id, isArchived: updated.isArchived });
  } catch (err: any) {
    console.error("Crisis Event archive error:", err);
    return NextResponse.json({ error: "We couldn't archive this event right now." }, { status: 500 });
  }
}
