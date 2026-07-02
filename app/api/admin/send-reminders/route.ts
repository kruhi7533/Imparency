import { NextRequest, NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { runAllAdminReminders } from "@/lib/reminders";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { authorized, response } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  try {
    const results = await runAllAdminReminders();
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[admin/send-reminders] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
