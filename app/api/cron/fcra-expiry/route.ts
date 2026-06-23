import { NextRequest, NextResponse } from "next/server";
import { runFcraExpiryMaintenance } from "@/lib/fcra-reminders";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runFcraExpiryMaintenance();
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[cron/fcra-expiry] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
