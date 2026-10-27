import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { describeFaultInjection, faultInjectionAllowed, parseFaultMode, setAiFaultSetting } from "@/lib/ai/fault-injection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI-010 fault injection switch. GET reports the state; POST { mode: "timeout"
 * | "error" | "off" } sets the AppSetting. Refused with 403 in production unless
 * AI_FAULT_INJECTION_ALLOW_PRODUCTION=true — and even a stored setting is
 * ignored there (lib/ai/fault-injection.ts), so a forgotten switch is inert.
 */
export async function GET() {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  return NextResponse.json(await describeFaultInjection());
}

export async function POST(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  if (!faultInjectionAllowed()) {
    return NextResponse.json(
      { error: "Fault injection is disabled in production. Set AI_FAULT_INJECTION_ALLOW_PRODUCTION=true to permit it.", code: "FORBIDDEN_IN_PRODUCTION" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const raw = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : null;
  if (raw !== "off" && !parseFaultMode(raw)) {
    return NextResponse.json({ error: 'mode must be "timeout", "error" or "off".' }, { status: 400 });
  }
  const mode = raw === "off" ? null : parseFaultMode(raw);

  const before = await describeFaultInjection();
  try {
    await setAiFaultSetting(mode);
  } catch {
    return NextResponse.json({ error: "Could not save the setting." }, { status: 500 });
  }
  const after = await describeFaultInjection();

  await logAdminAction({
    adminId: auth.session.user.id,
    action: "AI_FAULT_INJECTION_CHANGED",
    entityType: "AI",
    entityId: "fault-injection",
    oldValue: { mode: before.settingMode ?? "off" },
    newValue: { mode: mode ?? "off" },
    request,
  });

  return NextResponse.json(after);
}
