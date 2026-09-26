import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { generateFcraQuarterlyReport } from "@/lib/fcra-quarterly";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { authorized, response, session } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  try {
    const report = await generateFcraQuarterlyReport(session.user.id);

    // A quarterly FCRA report is a compliance document about real
    // organisations. Who produced it, and for which quarter, is part of the
    // document's provenance — without it there is no way to answer "where did
    // this figure come from" later.
    await logAdminAction({
      adminId: session.user.id,
      action: "FCRA_REPORT_GENERATED",
      entityType: "FCRA_REPORT",
      entityId: report.id,
      note: `Generated the FCRA quarterly report for ${report.quarter}`,
      metadata: { quarter: report.quarter },
      request: req,
    });

    return NextResponse.json({ ok: true, reportId: report.id, quarter: report.quarter });
  } catch (err: any) {
    console.error("[admin/fcra-report/generate] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
