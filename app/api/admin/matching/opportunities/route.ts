import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkFunderEligibility } from "@/lib/matching/funder";
import { validateCriteria, parseAmount, type CriterionBody } from "@/lib/matching/validate-criteria";

export const runtime = "nodejs";

/**
 * ADMIN-only. Create a funding opportunity and the criteria it declares.
 *
 * Created as DRAFT. It cannot be matched against until it is opened, and
 * PATCH refuses to open one that declares no criteria — an opportunity with no
 * rules would make every organisation on the platform eligible.
 */
export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;
  const adminId = auth.session.user.id;

  try {
    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const funderName = typeof body.funderName === "string" ? body.funderName.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const criteria: CriterionBody[] = Array.isArray(body.criteria) ? body.criteria : [];

    if (!title || !funderName) {
      return NextResponse.json({ error: "Title and funder name are required" }, { status: 400 });
    }

    // Optional, because most funders are offline. When one IS given it must be
    // a real institutional donor account — otherwise "the funder was notified"
    // would silently mean an email went to an individual donor, or nobody.
    const funderUserId =
      typeof body.funderUserId === "string" && body.funderUserId.trim()
        ? body.funderUserId.trim()
        : null;

    if (funderUserId) {
      const check = await checkFunderEligibility(funderUserId);
      if (!check.ok) {
        return NextResponse.json({ error: check.message }, { status: 400 });
      }
    }

    const amountResult = parseAmount(body.amount);
    if (!amountResult.ok) {
      return NextResponse.json({ error: amountResult.error }, { status: 400 });
    }
    const amount = amountResult.amount;

    // Validate every criterion before writing any of them: a half-created
    // opportunity with some rules silently missing is worse than a rejection.
    const criteriaResult = validateCriteria(criteria);
    if (!criteriaResult.ok) {
      return NextResponse.json({ error: criteriaResult.error }, { status: 400 });
    }
    const rows = criteriaResult.rows;

    const opportunity = await prisma.fundingOpportunity.create({
      data: {
        title,
        funderName,
        description,
        status: "DRAFT",
        createdById: adminId,
        funderUserId,
        amount,
        criteria: { create: rows },
      },
      select: { id: true },
    });

    await logAdminAction({
      adminId,
      action: "OPPORTUNITY_CREATED",
      entityType: "OPPORTUNITY",
      entityId: opportunity.id,
      newValue: { status: "DRAFT" },
      // Kinds and counts only — never the free-text description.
      metadata: {
        criteriaCount: rows.length,
        criteriaKinds: rows.map((c) => c.kind),
        // Whether a funder can be reached at all, without logging who.
        funderLinked: funderUserId !== null,
      },
      request,
    });

    return NextResponse.json({ id: opportunity.id, status: "DRAFT" }, { status: 201 });
  } catch (err: any) {
    console.error("Failed to create opportunity:", err);
    return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
  }
}
