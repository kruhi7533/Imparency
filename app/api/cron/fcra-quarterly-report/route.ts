import { NextRequest, NextResponse } from "next/server";
import { generateFcraQuarterlyReport } from "@/lib/fcra-quarterly";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await generateFcraQuarterlyReport();
    return NextResponse.json({ ok: true, quarter: report.quarter, totalNgos: report.totalNgos });
  } catch (err: any) {
    console.error("[cron/fcra-quarterly-report] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
