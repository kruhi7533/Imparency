import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { createAuditCheckpoint } from "@/lib/audit-chain";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — sign the current chain head (HMAC with AUDIT_CHAIN_KEY when set). The integrity page lists checkpoints server-side. */
export async function POST(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;
  try {
    const cp = await createAuditCheckpoint(auth.session.user.id);
    await logAdminAction({
      adminId: auth.session.user.id,
      action: "AUDIT_CHECKPOINT_CREATED",
      entityType: "SYSTEM",
      entityId: cp.id,
      newValue: { seq: cp.seq, hash: cp.hash, signed: !!cp.hmac },
      request,
    });
    return NextResponse.json({ checkpoint: cp, signed: !!cp.hmac }, { status: 201 });
  } catch (err) {
    captureError(err, { scope: "api/admin/audit/checkpoint", operation: "create_checkpoint" });
    return NextResponse.json({ error: "Could not record a checkpoint." }, { status: 500 });
  }
}
