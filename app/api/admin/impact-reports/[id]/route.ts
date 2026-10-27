import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { isReportAction, reportTransition, serializeReport } from "@/lib/contract-impact-reports";

/**
 * PATCH /api/admin/impact-reports/[id] { action: "PUBLISH" | "RETURN", note? }
 *
 * The human gate between an NGO's submitted funder report and the donor. A
 * return needs a note (what to fix). Compare-and-swap: 409 if someone else
 * decided first.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
    if (!authorized) return response;

    const body = await request.json().catch(() => null);
    if (!isReportAction(body?.action) || body.action === "SUBMIT") {
      return NextResponse.json({ error: "action must be PUBLISH or RETURN" }, { status: 400 });
    }
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (body.action === "RETURN" && !note) {
      return NextResponse.json({ error: "A note is required when returning a report." }, { status: 400 });
    }

    const report = await prisma.contractImpactReport.findUnique({ where: { id: params.id } });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const t = reportTransition(body.action, report.status, "ADMIN");
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });

    const now = new Date();
    const { count } = await prisma.contractImpactReport.updateMany({
      where: { id: report.id, status: report.status },
      data:
        body.action === "PUBLISH"
          ? { status: t.to, publishedAt: now, publishedById: session.user.id, reviewNote: note || null }
          : { status: t.to, reviewNote: note },
    });
    if (count === 0) return NextResponse.json({ error: "Another reviewer decided this report first." }, { status: 409 });

    await logAdminAction({
      adminId: session.user.id,
      action: body.action === "PUBLISH" ? "IMPACT_REPORT_PUBLISHED" : "IMPACT_REPORT_RETURNED",
      entityType: "IMPACT_REPORT",
      entityId: report.id,
      oldValue: { status: report.status },
      newValue: { status: t.to },
      metadata: { contractId: report.contractId, claimCount: report.claimIds.length },
      request,
    });

    // Tell the other side. Ids and titles only; failures never undo the decision.
    try {
      if (body.action === "PUBLISH") {
        await prisma.notification.create({
          data: {
            userId: report.donorId,
            type: "IMPACT_REPORT_PUBLISHED",
            title: "New impact report",
            body: `"${report.title}" has been published on your contract. Open the contract to read it and renew or ask about next steps.`,
          },
        });
      } else {
        const ngo = await prisma.nGOProfile.findUnique({ where: { id: report.ngoId }, select: { userId: true } });
        if (ngo) {
          await prisma.notification.create({
            data: { userId: ngo.userId, type: "IMPACT_REPORT_RETURNED", title: "Impact report returned", body: `"${report.title}" was returned by review: ${note}` },
          });
        }
      }
    } catch (err) {
      console.error("[admin/impact-reports] notification failed for", report.id, err);
    }

    const updated = await prisma.contractImpactReport.findUnique({ where: { id: report.id } });
    return NextResponse.json({ report: serializeReport(updated) });
  } catch (error) {
    console.error("[api/admin/impact-reports/[id]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to decide report" }, { status: 500 });
  }
}
