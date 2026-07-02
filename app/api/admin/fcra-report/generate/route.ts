import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { generateFcraQuarterlyReport } from "@/lib/fcra-quarterly";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { authorized, response, session } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  try {
    const report = await generateFcraQuarterlyReport(session.user.id);
    return NextResponse.json({ ok: true, reportId: report.id, quarter: report.quarter });
  } catch (err: any) {
    console.error("[admin/fcra-report/generate] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
