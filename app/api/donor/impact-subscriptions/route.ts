import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export const runtime = "nodejs";

const VALID_CHANNELS = new Set(["IN_APP", "EMAIL"]);
const VALID_FREQUENCIES = new Set(["INSTANT", "DAILY_DIGEST", "WEEKLY_DIGEST"]);

/** Update the donor's own subscription preferences for one project. */
export async function PATCH(request: Request) {
  const auth = await verifySessionRole(Role.DONOR);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { projectId, channels, frequency, active } = body;

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (channels !== undefined && (!Array.isArray(channels) || channels.some((c) => !VALID_CHANNELS.has(c)))) {
      return NextResponse.json({ error: "Invalid channels" }, { status: 400 });
    }
    if (frequency !== undefined && !VALID_FREQUENCIES.has(frequency)) {
      return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
    }

    // Ownership is inherent: the unique key includes the session donor id, so
    // a donor can only ever touch their own subscription.
    const sub = await prisma.impactSubscription.update({
      where: { donorId_projectId: { donorId: auth.session.user.id, projectId } },
      data: {
        ...(channels !== undefined ? { channels } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(active !== undefined ? { active: !!active } : {}),
      },
    });

    return NextResponse.json({ success: true, subscription: sub });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }
    console.error("Impact subscription update error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
