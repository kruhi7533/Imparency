import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { dismissDeadLetter } from "@/lib/dead-letter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/dead-letters/[id]/dismiss — close an OPEN or REPLAY_FAILED entry without replaying. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  const res = await dismissDeadLetter(params.id, auth.session.user.id);
  if (!res.ok) {
    if (res.currentStatus === null) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ error: `Cannot dismiss: already ${res.currentStatus}.`, status: res.currentStatus }, { status: 409 });
  }
  await logAdminAction({
    adminId: auth.session.user.id,
    action: "DEAD_LETTER_DISMISSED",
    entityType: "DEAD_LETTER",
    entityId: params.id,
    newValue: { status: "DISMISSED" },
    request,
  });
  return NextResponse.json({ status: "DISMISSED" });
}
