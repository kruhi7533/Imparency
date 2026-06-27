import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { generateFcraQuarterlyReport } from "@/lib/fcra-quarterly";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await generateFcraQuarterlyReport(session.user.id);
    return NextResponse.json({ ok: true, reportId: report.id, quarter: report.quarter });
  } catch (err: any) {
    console.error("[admin/fcra-report/generate] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
