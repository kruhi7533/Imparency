import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";

export async function PATCH(
  request: Request,
  { params }: { params: { eventId: string } }
) {
  try {
    const { eventId } = params;

    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }

    const { authorized, session, response } = await verifySessionRole("DONOR");
    if (!authorized) return response!;

    // Find the event
    const event = await prisma.reEngagementEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Verify ownership
    if (event.donorId !== session!.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Dismiss the event
    await prisma.reEngagementEvent.update({
      where: { id: eventId },
      data: { dismissed: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const err = error as Error;
    console.error("Error dismissing re-engagement event:", err);
    return NextResponse.json(
      { error: err.message || "Failed to dismiss event" },
      { status: 500 }
    );
  }
}
