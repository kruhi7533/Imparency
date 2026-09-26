import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin-log";
import { requireActor, assertAdmin, assertCanViewRequirement } from "@/lib/requirements/access";
import { recordRequirementEvent } from "@/lib/requirements/audit";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import { serializeMatchRun } from "@/lib/requirements/dto";
import { errorResponse, readJson } from "@/lib/requirements/http";

async function loadReport(id: string) {
  const report = await prisma.gapReport.findUnique({
    where: { id },
    include: {
      sponsorRequirement: { select: { id: true, sponsorId: true, status: true } },
      matches: {
        orderBy: [{ eligible: "desc" }, { rank: "asc" }],
        include: { project: { select: { title: true } }, ngo: { select: { orgName: true } } },
      },
    },
  });
  if (!report) throw new RequirementWorkflowError("Gap report not found.", 404);
  return report;
}

/** Owner of the underlying requirement or an admin. Everyone else (incl. NGOs) → 403. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const report = await loadReport(params.id);
    assertCanViewRequirement(report.sponsorRequirement, actor);
    return NextResponse.json({ gap: { ...serializeMatchRun(report), requirementId: report.sponsorRequirement.id } });
  } catch (err) {
    return errorResponse(err, "api/gap-analysis/report GET");
  }
}

/**
 * Admin review of an analysis run. Body: { action: "approve" | "reject" | "request-reanalysis", note? }.
 * A rejected run blocks further invitations; the donor/admin re-runs matching.
 * Donors cannot call this — the donor UI never shows these controls.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    assertAdmin(actor);
    const body = await readJson(req);
    const action = body.action;
    if (!["approve", "reject", "request-reanalysis"].includes(action)) {
      throw new RequirementWorkflowError("Invalid action.", 400);
    }
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
    if (action !== "approve" && !note) {
      throw new RequirementWorkflowError("Add a note explaining why the analysis is rejected.", 400);
    }

    const report = await loadReport(params.id);
    const reviewStatus = action === "approve" ? "APPROVED" : "REJECTED";
    const detail =
      action === "approve"
        ? "Admin approved the matching analysis."
        : action === "reject"
        ? `Admin rejected the matching analysis: ${note}`
        : `Admin requested re-analysis: ${note}`;

    await prisma.$transaction(async (tx) => {
      await tx.gapReport.update({
        where: { id: params.id },
        data: { reviewStatus, reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note },
      });
      await recordRequirementEvent(tx, {
        requirementId: report.sponsorRequirement.id,
        action: action === "approve" ? "GAP_REPORT_APPROVED" : "GAP_REPORT_REJECTED",
        actorId: actor.id,
        actorRole: "ADMIN",
        fromStatus: report.sponsorRequirement.status,
        toStatus: report.sponsorRequirement.status,
        detail,
        metadata: { gapReportId: params.id },
      });
    });
    await logAdminAction({
      adminId: actor.id,
      action: action === "approve" ? "GAP_REPORT_APPROVED" : "GAP_REPORT_REJECTED",
      entityType: "GAP_REPORT",
      entityId: params.id,
      oldValue: { reviewStatus: report.reviewStatus },
      newValue: { reviewStatus },
      note,
      request: req,
    });
    return NextResponse.json({ status: reviewStatus });
  } catch (err) {
    return errorResponse(err, "api/gap-analysis/report PUT");
  }
}
