import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";

/** DON-018: the caller's own recent notification delivery attempts. Own rows only. */
export async function GET(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 30));
  try {
    const deliveries = await prisma.notificationDeliveryLog.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, eventKey: true, topic: true, channel: true, status: true, reason: true, attempt: true, title: true, createdAt: true },
    });
    return NextResponse.json({ deliveries });
  } catch (error) {
    console.error("[api/donor/notification-deliveries] GET error:", error);
    return NextResponse.json({ error: "Failed to load delivery log" }, { status: 500 });
  }
}
