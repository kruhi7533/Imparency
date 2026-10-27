import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { adminMatchBankLine, BankLineMatchError } from "@/lib/utr-sweep";

export const runtime = "nodejs";

/**
 * ADMIN-only. Manually match an unmatched bank-statement line (from the
 * UNMATCHED_BANK_LINE exception queue) to a pending contract payment.
 * Body: { paymentId, note }  — note required, it is kept on the record.
 *
 * Reconciles the payment, marks the line MATCHED, resolves the exception and
 * recalculates milestone funding, all audited. Replaying the same match is 200.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  const body = await request.json().catch(() => null);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) : "";
  if (!body || typeof body.paymentId !== "string" || !body.paymentId) {
    return NextResponse.json({ error: "paymentId is required." }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: "Say why this line is that payment — the note is kept on the record." }, { status: 400 });
  }

  try {
    const result = await adminMatchBankLine({ lineId: params.id, paymentId: body.paymentId, adminId: session.user.id, note });
    if (!result.replayed) {
      await logAdminAction({
        adminId: session.user.id,
        action: "FINANCE_EXCEPTION_RESOLVED",
        entityType: "FINANCE_EXCEPTION",
        entityId: params.id,
        oldValue: { lineStatus: "UNMATCHED" },
        newValue: { lineStatus: "MATCHED", paymentStatus: "RECONCILED" },
        note,
        metadata: { resolution: "MANUAL_BANK_MATCH", bankLineId: params.id, paymentId: body.paymentId, contractId: result.contractId },
        request,
      });
    }
    return NextResponse.json({ ok: true, replayed: result.replayed });
  } catch (err) {
    if (err instanceof BankLineMatchError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/admin/finance/bank-lines/[id]/match] error:", err);
    return NextResponse.json({ error: "Failed to match the bank line" }, { status: 500 });
  }
}
