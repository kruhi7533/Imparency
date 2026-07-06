import { NextRequest, NextResponse } from "next/server";
import { runAllAdminReminders } from "@/lib/reminders";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAllAdminReminders();
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[cron/reminders] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
