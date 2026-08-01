import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";

export async function POST() {
  const auth = await verifySessionRole();
  if (!auth.authorized) return auth.response;

  try {
    await prisma.user.update({
      where: { id: auth.session.user.id },
      data: { crisisAlertsOptOut: true },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Crisis alerts unsubscribe error:", err);
    return NextResponse.json({ error: "Failed to update your notification preference" }, { status: 500 });
  }
}

export async function DELETE() {
  // Re-subscribe.
  const auth = await verifySessionRole();
  if (!auth.authorized) return auth.response;

  try {
    await prisma.user.update({
      where: { id: auth.session.user.id },
      data: { crisisAlertsOptOut: false },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Crisis alerts re-subscribe error:", err);
    return NextResponse.json({ error: "Failed to update your notification preference" }, { status: 500 });
  }
}
