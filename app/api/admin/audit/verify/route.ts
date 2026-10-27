import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { verifyAuditChain } from "@/lib/audit-chain";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit/verify — ADM-017. Walks the whole audit hash chain and
 * reports OK or the FIRST break: its seq / id and why (HASH_MISMATCH,
 * PREV_MISMATCH, GAP, UNCHAINED_ROW, HEAD_MISMATCH, CHECKPOINT_*).
 *
 * ADMIN only — the platform has no separate auditor role (Role is DONOR / NGO /
 * ADMIN). The verification itself is logged, with its verdict.
 */
export async function GET(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  let result;
  try {
    result = await verifyAuditChain();
  } catch (err) {
    captureError(err, { scope: "api/admin/audit/verify", operation: "verify_chain" });
    return NextResponse.json({ error: "The audit chain could not be read. Check that migrations are applied (npm run db:sync)." }, { status: 503 });
  }

  await logAdminAction({
    adminId: auth.session.user.id,
    action: "AUDIT_CHAIN_VERIFIED",
    entityType: "SYSTEM",
    entityId: "audit-trail",
    metadata: {
      ok: result.ok,
      checkedRows: result.checkedRows,
      headSeq: result.head?.seq ?? null,
      breakSeq: result.firstBreak?.seq ?? null,
      breakReason: result.firstBreak?.reason ?? null,
    },
    request,
  });

  return NextResponse.json(result);
}
