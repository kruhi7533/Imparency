import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { VISIT_GAP_MS } from "@/lib/today-inbox";

export const runtime = "nodejs";

/**
 * ADMIN-only. Record that this admin has now seen Today.
 *
 * Called from the browser after the page renders rather than during the render
 * itself: a Server Component runs on prefetch too, so advancing the marker
 * there would burn through "new since you looked" for a page nobody opened.
 *
 * Advances only after a real gap. Two loads inside VISIT_GAP_MS are the same
 * visit, so refreshing does not wipe out what the page is currently showing as
 * new.
 */
export async function POST() {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  const adminId = session.user.id;

  try {
    const now = new Date();
    const existing = await prisma.adminInboxVisit.findUnique({ where: { adminId } });

    if (!existing) {
      await prisma.adminInboxVisit.create({
        data: { adminId, lastVisitAt: now, previousVisitAt: now },
      });
      return NextResponse.json({ advanced: true });
    }

    if (now.getTime() - existing.lastVisitAt.getTime() <= VISIT_GAP_MS) {
      return NextResponse.json({ advanced: false });
    }

    await prisma.adminInboxVisit.update({
      where: { adminId },
      data: { previousVisitAt: existing.lastVisitAt, lastVisitAt: now },
    });
    return NextResponse.json({ advanced: true });
  } catch (err: any) {
    console.error("Failed to record inbox visit:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
