import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["SENT", "FAILED", "OPTED_OUT", "PROVIDER_NOT_CONFIGURED"];
const CHANNELS = ["IN_APP", "WHATSAPP", "EMAIL"];

/**
 * GET /api/admin/notification-deliveries?status=&channel=&userId= — DON-018 /
 * NEG-011. Every donor notification attempt: channel, status, reason. Ids only
 * (no email or phone); the message title is shown for context.
 */
export async function GET(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status")?.toUpperCase();
  const channel = sp.get("channel")?.toUpperCase();
  const userId = sp.get("userId")?.trim();
  const deliveries = await prisma.notificationDeliveryLog.findMany({
    where: {
      ...(status && STATUSES.includes(status) ? { status } : {}),
      ...(channel && CHANNELS.includes(channel) ? { channel } : {}),
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, Number(sp.get("limit")) || 100)),
    select: { id: true, userId: true, eventKey: true, topic: true, channel: true, status: true, reason: true, attempt: true, title: true, createdAt: true },
  });
  return NextResponse.json({ deliveries });
}
