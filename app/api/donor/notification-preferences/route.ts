import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { getChannelPreferences } from "@/lib/notification-dispatch";

/**
 * A donor's own notification preferences. Only ever the caller's own row —
 * there is no id parameter to tamper with.
 *
 * `projectUpdates` (Week 7) is the topic switch: milestone-verified and
 * verified-evidence updates for projects the donor funds. Turning it off stops
 * messages; the funded-project pages keep showing everything.
 *
 * `channels` (DON-018) are per-channel switches: WhatsApp, email, in-app.
 * WhatsApp is preferred; when it is off or cannot send, the update falls back
 * to email, and in-app is always delivered while on. Every attempt is recorded
 * — see GET /api/donor/notification-deliveries.
 */
const CHANNEL_KEYS = ["whatsapp", "email", "inApp"] as const;

export async function GET() {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  try {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { projectUpdatesOptOut: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const channels = await getChannelPreferences(session.user.id);
    return NextResponse.json({ projectUpdates: !user.projectUpdatesOptOut, channels });
  } catch (error) {
    console.error("[api/donor/notification-preferences] GET error:", error);
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send projectUpdates and/or channels as true/false values." }, { status: 400 });
  }
  const hasTopic = "projectUpdates" in body;
  if (hasTopic && typeof body.projectUpdates !== "boolean") {
    return NextResponse.json({ error: "projectUpdates must be true or false." }, { status: 400 });
  }
  const channelInput = body.channels ?? {};
  if (typeof channelInput !== "object" || channelInput === null) {
    return NextResponse.json({ error: "channels must be an object." }, { status: 400 });
  }
  const channelPatch: Partial<Record<(typeof CHANNEL_KEYS)[number], boolean>> = {};
  for (const key of CHANNEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(channelInput, key)) continue;
    if (typeof channelInput[key] !== "boolean") {
      return NextResponse.json({ error: `channels.${key} must be true or false.` }, { status: 400 });
    }
    channelPatch[key] = channelInput[key];
  }
  if (!hasTopic && Object.keys(channelPatch).length === 0) {
    return NextResponse.json({ error: "projectUpdates must be true or false." }, { status: 400 });
  }

  try {
    // Setting values, not toggling, so a retried request cannot flip them back.
    if (hasTopic) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { projectUpdatesOptOut: !body.projectUpdates },
      });
    }
    if (Object.keys(channelPatch).length > 0) {
      await prisma.notificationPreference.upsert({
        where: { userId: session.user.id },
        create: { userId: session.user.id, whatsapp: true, email: true, inApp: true, ...channelPatch },
        update: channelPatch,
      });
    }
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { projectUpdatesOptOut: true } });
    const channels = await getChannelPreferences(session.user.id);
    return NextResponse.json({ projectUpdates: hasTopic ? body.projectUpdates : !user?.projectUpdatesOptOut, channels });
  } catch (error) {
    console.error("[api/donor/notification-preferences] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }
}
