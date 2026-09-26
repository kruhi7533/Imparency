import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const { featured } = await request.json();
    if (typeof featured !== "boolean") {
      return NextResponse.json({ error: "featured must be a boolean" }, { status: 400 });
    }

    const event = await prisma.crisisEvent.findUnique({ where: { id: params.id } });
    if (!event) return NextResponse.json({ error: "Crisis event not found" }, { status: 404 });

    if (featured && event.verificationStatus !== "VERIFIED") {
      return NextResponse.json({ error: "Only a verified event can be featured" }, { status: 400 });
    }

    const updated = await prisma.crisisEvent.update({
      where: { id: params.id },
      data: { isFeatured: featured },
    });

    await logAdminAction({
      adminId: session.user.id,
      action: featured ? "CRISIS_EVENT_FEATURED" : "CRISIS_EVENT_UNFEATURED",
      entityType: "CRISIS_EVENT",
      entityId: event.id,
      oldValue: { isFeatured: event.isFeatured },
      newValue: { isFeatured: featured },
      request,
    });

    return NextResponse.json({ id: updated.id, isFeatured: updated.isFeatured });
  } catch (err: any) {
    console.error("Crisis Event feature toggle error:", err);
    return NextResponse.json({ error: "We couldn't update the featured flag right now." }, { status: 500 });
  }
}
