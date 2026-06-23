import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { runAllAdminReminders } from "@/lib/reminders";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await runAllAdminReminders();
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[admin/send-reminders] error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
