import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import {
  CAN_REPORT,
  claimsInPeriod,
  isReportAction,
  isReportEditable,
  loadReportFigures,
  parseReportInput,
  reportTransition,
  reportableClaimIds,
  serializeReport,
} from "@/lib/contract-impact-reports";

export const dynamic = "force-dynamic";

async function load(id: string, userId: string) {
  const actor = await resolveNgoActor(userId);
  if (!actor) return { error: NextResponse.json({ error: "No NGO membership" }, { status: 403 }) };
  const report = await prisma.contractImpactReport.findUnique({ where: { id } });
  if (!report) return { error: NextResponse.json({ error: "Report not found" }, { status: 404 }) };
  if (report.ngoId !== actor.ngoId) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { actor, report };
}

/** GET — one report with its figures (rendered through claimDisplay) and renewal requests. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const r = await load(params.id, session.user.id);
    if ("error" in r) return r.error;

    const [{ figures, pendingNotIncluded }, renewalRequests] = await Promise.all([
      loadReportFigures(r.report),
      prisma.renewalRequest.findMany({ where: { reportId: r.report.id }, orderBy: { createdAt: "desc" } }),
    ]);
    return NextResponse.json({
      report: serializeReport(r.report),
      figures,
      pendingNotIncluded,
      renewalRequests: renewalRequests.map((q) => ({
        id: q.id,
        kind: q.kind,
        status: q.status,
        message: q.message,
        proposedAmount: q.proposedAmount?.toString() ?? null,
        ngoResponse: q.ngoResponse,
        createdAt: q.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[api/ngo/impact-reports/[id]] GET error:", error);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
}

/**
 * PATCH — edit a DRAFT/RETURNED report ({ title?, summary?, periodStart?, periodEnd? })
 * or submit it ({ action: "SUBMIT" }). Submission pins the APPROVED claims in
 * the period; with none, there is nothing verified to report and it is refused.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const r = await load(params.id, session.user.id);
    if ("error" in r) return r.error;
    if (!CAN_REPORT.includes(r.actor.teamRole)) {
      return NextResponse.json({ error: "Only an owner or admin can edit funder reports." }, { status: 403 });
    }
    const body = await request.json().catch(() => null);

    if (body?.action !== undefined) {
      if (!isReportAction(body.action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
      const t = reportTransition(body.action, r.report.status, "NGO");
      if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });

      const claims = await claimsInPeriod(r.report.projectId, r.report.periodStart, r.report.periodEnd);
      const claimIds = reportableClaimIds(claims);
      if (claimIds.length === 0) {
        return NextResponse.json(
          {
            error: "No approved outcome claims fall inside this period. A report to a funder is built only from approved claims — get claims approved in Impact first, or change the period.",
            code: "NO_APPROVED_CLAIMS",
          },
          { status: 422 },
        );
      }
      const { count } = await prisma.contractImpactReport.updateMany({
        where: { id: r.report.id, status: r.report.status },
        data: { status: t.to, claimIds, submittedAt: new Date(), submittedById: session.user.id, reviewNote: null },
      });
      if (count === 0) return NextResponse.json({ error: "The report changed while you were submitting it. Reload." }, { status: 409 });
      const updated = await prisma.contractImpactReport.findUnique({ where: { id: r.report.id } });
      return NextResponse.json({ report: serializeReport(updated) });
    }

    if (!isReportEditable(r.report.status)) {
      return NextResponse.json({ error: `A ${r.report.status} report cannot be edited.` }, { status: 409 });
    }
    const parsed = parseReportInput(body, true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const start = parsed.value.periodStart ?? r.report.periodStart;
    const end = parsed.value.periodEnd ?? r.report.periodEnd;
    if (start >= end) return NextResponse.json({ error: "periodStart must be before periodEnd" }, { status: 400 });

    const { count } = await prisma.contractImpactReport.updateMany({
      where: { id: r.report.id, status: r.report.status },
      data: parsed.value,
    });
    if (count === 0) return NextResponse.json({ error: "The report changed. Reload." }, { status: 409 });
    const updated = await prisma.contractImpactReport.findUnique({ where: { id: r.report.id } });
    return NextResponse.json({ report: serializeReport(updated) });
  } catch (error) {
    console.error("[api/ngo/impact-reports/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update report" }, { status: 500 });
  }
}
