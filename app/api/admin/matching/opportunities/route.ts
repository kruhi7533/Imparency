import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { RULES, isRuleKind } from "@/lib/matching/rules";

export const runtime = "nodejs";

interface CriterionBody {
  kind?: string;
  value?: string | null;
  values?: string[];
  required?: boolean;
}

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
      const funder = await prisma.user.findUnique({
        where: { id: funderUserId },
        select: { role: true, donorPersona: true },
      });
      const institutional = ["CSR_OFFICER", "FOUNDATION", "GOVERNMENT"];
      if (!funder || funder.role !== "DONOR" || !institutional.includes(funder.donorPersona ?? "")) {
        return NextResponse.json(
          { error: "The funder account must be a donor with a CSR, foundation or government persona." },
          { status: 400 }
        );
      }
    }

    // Validate every criterion before writing any of them: a half-created
    // opportunity with some rules silently missing is worse than a rejection.
    // Building the rows here rather than in a second pass keeps the narrowing
    // from isRuleKind, so no cast is needed downstream.
    const rows: { kind: string; value: string | null; values: string[]; required: boolean }[] = [];
    const seen = new Set<string>();
    for (const c of criteria) {
      if (!c.kind || !isRuleKind(c.kind)) {
        return NextResponse.json(
          { error: `Unknown criterion "${c.kind ?? ""}".` },
          { status: 400 }
        );
      }
      if (seen.has(c.kind)) {
        return NextResponse.json(
          { error: `Criterion "${c.kind}" is declared more than once.` },
          { status: 400 }
        );
      }
      seen.add(c.kind);

      const rule = RULES[c.kind];
      if (rule.param === "scalar" && !String(c.value ?? "").trim()) {
        return NextResponse.json(
          { error: `"${rule.label}" needs a value.` },
          { status: 400 }
        );
      }
      if (rule.param === "set" && (!Array.isArray(c.values) || c.values.length === 0)) {
        return NextResponse.json(
          { error: `"${rule.label}" needs at least one value.` },
          { status: 400 }
        );
      }

      rows.push({
        kind: rule.kind,
        value: rule.param === "scalar" ? String(c.value ?? "").trim() : null,
        values: rule.param === "set" ? (c.values ?? []).map((v) => v.trim()).filter(Boolean) : [],
        required: c.required !== false,
      });
    }

    const opportunity = await prisma.fundingOpportunity.create({
      data: {
        title,
        funderName,
        description,
        status: "DRAFT",
        createdById: adminId,
        funderUserId,
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
