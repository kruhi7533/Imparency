import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { CAN_REPORT, REPORTABLE_CONTRACT_STATUSES, parseReportInput, serializeReport } from "@/lib/contract-impact-reports";

export const dynamic = "force-dynamic";

/** GET /api/ngo/impact-reports[?contractId=] — the caller's organisation's stored reports. */
export async function GET(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });

    const contractId = new URL(request.url).searchParams.get("contractId");
    const reports = await prisma.contractImpactReport.findMany({
      where: { ngoId: actor.ngoId, ...(contractId ? { contractId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ reports: reports.map(serializeReport), canEdit: CAN_REPORT.includes(actor.teamRole) });
  } catch (error) {
    console.error("[api/ngo/impact-reports] GET error:", error);
    return NextResponse.json({ error: "Failed to load reports" }, { status: 500 });
  }
}

/** POST { contractId, title, summary?, periodStart, periodEnd } — start a DRAFT report. */
export async function POST(request: Request) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const actor = await resolveNgoActor(session.user.id);
    if (!actor) return NextResponse.json({ error: "No NGO membership" }, { status: 403 });
    if (!CAN_REPORT.includes(actor.teamRole)) {
      return NextResponse.json({ error: "Only an owner or admin can write funder reports." }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const contractId = typeof body?.contractId === "string" ? body.contractId : "";
    if (!contractId) return NextResponse.json({ error: "contractId is required" }, { status: 400 });
    const parsed = parseReportInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { id: true, ngoId: true, donorId: true, projectId: true, status: true },
    });
    if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    if (contract.ngoId !== actor.ngoId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!(REPORTABLE_CONTRACT_STATUSES as readonly string[]).includes(contract.status)) {
      return NextResponse.json({ error: `Reports can be written only on an ACTIVE or COMPLETED contract; this one is ${contract.status}.` }, { status: 409 });
    }

    const v = parsed.value;
    const report = await prisma.contractImpactReport.create({
      data: {
        contractId: contract.id,
        ngoId: contract.ngoId,
        donorId: contract.donorId,
        projectId: contract.projectId,
        title: v.title!,
        summary: v.summary ?? "",
        periodStart: v.periodStart!,
        periodEnd: v.periodEnd!,
        claimIds: [],
        createdById: session.user.id,
      },
    });
    return NextResponse.json({ report: serializeReport(report) }, { status: 201 });
  } catch (error) {
    console.error("[api/ngo/impact-reports] POST error:", error);
    return NextResponse.json({ error: "Failed to create report" }, { status: 500 });
  }
}
