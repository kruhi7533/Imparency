import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * ADMIN-only. Open or close a funding opportunity.
 *
 * DRAFT -> OPEN -> CLOSED, enforced by compare-and-swap rather than a read
 * followed by a write, so two admins acting at once cannot both succeed.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const { action } = await request.json();
    if (action !== "OPEN" && action !== "CLOSE") {
      return NextResponse.json({ error: "action must be OPEN or CLOSE" }, { status: 400 });
    }

    const opportunity = await prisma.fundingOpportunity.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, _count: { select: { criteria: true } } },
    });
    if (!opportunity) {
      return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
    }

    // An opportunity with no criteria would make every organisation on the
    // platform eligible. The engine also returns UNKNOWN in that case, but
    // refusing here means the situation never reaches a funder at all.
    if (action === "OPEN" && opportunity._count.criteria === 0) {
      return NextResponse.json(
        { error: "Add at least one criterion before opening this opportunity." },
        { status: 400 }
      );
    }

    const from = action === "OPEN" ? "DRAFT" : "OPEN";
    const to = action === "OPEN" ? "OPEN" : "CLOSED";

    const { count } = await prisma.fundingOpportunity.updateMany({
      where: { id: params.id, status: from },
      data: { status: to },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: `Opportunity cannot be ${to.toLowerCase()} from its current status (${opportunity.status}).` },
        { status: 409 }
      );
    }

    await logAdminAction({
      adminId,
      action: action === "OPEN" ? "OPPORTUNITY_OPENED" : "OPPORTUNITY_CLOSED",
      entityType: "OPPORTUNITY",
      entityId: params.id,
      oldValue: { status: from },
      newValue: { status: to },
      request,
    });

    return NextResponse.json({ id: params.id, status: to });
  } catch (err: any) {
    console.error("Failed to update opportunity:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
