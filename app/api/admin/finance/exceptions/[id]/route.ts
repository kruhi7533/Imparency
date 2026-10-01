import { NextResponse } from "next/server";
import { Role, FinanceExceptionStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";

export const runtime = "nodejs";

/**
 * ADMIN-only. Close one finance exception.
 *
 * A note is REQUIRED. Closing a money discrepancy without saying why is
 * indistinguishable from hiding it, and the note is the only thing that
 * survives to explain a gap between the ledger and a counter — the same
 * reasoning as the mandatory rejection reason on a proposal.
 *
 * Compare-and-swap on OPEN: two admins resolving at once means the second gets
 * a 409 rather than overwriting the first one's note.
 *
 * There is deliberately no reopen. If the discrepancy is still real, the next
 * reconciliation run raises it again as a NEW exception, which records that it
 * came back after someone said it was handled.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;

  let body: { note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) {
    return NextResponse.json(
      { error: "Say what was done about this discrepancy — a resolution without a reason is not one." },
      { status: 400 },
    );
  }

  const existing = await prisma.financeException.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, type: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Exception not found" }, { status: 404 });
  }

  const { count } = await prisma.financeException.updateMany({
    where: { id: params.id, status: FinanceExceptionStatus.OPEN },
    data: {
      status: FinanceExceptionStatus.RESOLVED,
      resolvedAt: new Date(),
      resolvedById: session.user.id,
      resolutionNote: note,
    },
  });

  if (count === 0) {
    return NextResponse.json(
      { error: "This exception was already resolved." },
      { status: 409 },
    );
  }

  await logAdminAction({
    adminId: session.user.id,
    action: "FINANCE_EXCEPTION_RESOLVED",
    entityType: "FINANCE_EXCEPTION",
    entityId: params.id,
    oldValue: { status: FinanceExceptionStatus.OPEN },
    newValue: { status: FinanceExceptionStatus.RESOLVED },
    note,
    metadata: { type: existing.type },
    request,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
