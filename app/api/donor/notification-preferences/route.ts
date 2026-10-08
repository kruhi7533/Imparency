import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";

/**
 * A donor's own notification preferences (Week 7: "approved notifications +
 * opt-out"). Only ever the caller's own row — there is no id parameter to
 * tamper with.
 *
 * `projectUpdates` covers milestone-verified and verified-evidence updates for
 * projects the donor funds (lib/contract-donor-updates.ts). Turning it off
 * stops messages; the funded-project pages keep showing everything.
 */
export async function GET() {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  try {
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { projectUpdatesOptOut: true } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ projectUpdates: !user.projectUpdatesOptOut });
  } catch (error) {
    console.error("[api/donor/notification-preferences] GET error:", error);
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.projectUpdates !== "boolean") {
    return NextResponse.json({ error: "projectUpdates must be true or false." }, { status: 400 });
  }
  try {
    // Setting a value, not toggling it, so a retried request cannot flip it back.
    await prisma.user.update({
      where: { id: session.user.id },
      data: { projectUpdatesOptOut: !body.projectUpdates },
    });
    return NextResponse.json({ projectUpdates: body.projectUpdates });
  } catch (error) {
    console.error("[api/donor/notification-preferences] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }
}
