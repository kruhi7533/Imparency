import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { Role } from "@prisma/client";
import { getBoolSetting, setBoolSetting, SETTING_KEYS } from "@/lib/app-settings";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/** Read the "email admin on NGO reply" toggle. Defaults on. */
export async function GET() {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  const enabled = await getBoolSetting(SETTING_KEYS.EMAIL_ON_NGO_REPLY, true);
  return NextResponse.json({ enabled });
}

/** Flip the toggle. Body: { enabled: boolean } */
export async function POST(request: Request) {
  const auth = await verifySessionRole(Role.ADMIN);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "`enabled` must be a boolean" }, { status: 400 });
    }

    const previous = await getBoolSetting(SETTING_KEYS.EMAIL_ON_NGO_REPLY, true);
    const saved = await setBoolSetting(SETTING_KEYS.EMAIL_ON_NGO_REPLY, body.enabled);
    if (!saved) {
      // Report the old value so the client's optimistic toggle snaps back
      // instead of showing a state that was never persisted.
      return NextResponse.json(
        { error: "Could not save the setting. Please try again.", enabled: previous },
        { status: 500 }
      );
    }

    await logAdminAction({
      adminId: auth.session.user.id,
      action: "SETTING_UPDATED",
      entityType: "SETTING",
      entityId: SETTING_KEYS.EMAIL_ON_NGO_REPLY,
      oldValue: { enabled: previous },
      newValue: { enabled: body.enabled },
      request,
    });

    return NextResponse.json({ enabled: body.enabled });
  } catch (err: any) {
    console.error("[admin/settings/ngo-reply-email] error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
