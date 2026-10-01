import { NextResponse } from "next/server";
import { Prisma, Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { checkPayment, paidTotal } from "@/lib/allocation";
import { allocationFundedEntry } from "@/lib/ledger";
import { isUniqueConstraintError } from "@/lib/razorpay-webhook";

export const runtime = "nodejs";

/**
 * ADMIN-only. Confirm that money committed to an allocation actually arrived.
 *
 * This is an ATTESTATION, not a payment. The platform does not move this money
 * — a funder pays the organisation directly — so what is recorded is that a
 * named admin says a transfer happened, with a reference a bank statement can
 * be checked against. Everything that displays it says so, because the gap
 * between "we confirmed this" and "we received this" is exactly the kind of
 * thing a transparency platform cannot afford to blur.
 *
 * Partial confirmations are first-class: commitments are often honoured in
 * tranches, and each one is its own row with its own date and reference.
 *
 * There is no delete. A mistaken confirmation is corrected by recording the
 * truth alongside it and explaining, not by making the first claim disappear.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  const adminId = session.user.id;

  let body: { amount?: unknown; paidAt?: unknown; reference?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawAmount = body.amount;
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") {
    return NextResponse.json({ error: "amount is required" }, { status: 400 });
  }
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(rawAmount.toString());
  } catch {
    return NextResponse.json({ error: "amount is not a number" }, { status: 400 });
  }

  // Defaults to now, because the common case is confirming a transfer the
  // admin is looking at today.
  const paidAt = typeof body.paidAt === "string" ? new Date(body.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    return NextResponse.json({ error: "paidAt is not a date" }, { status: 400 });
  }

  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  const allocation = await prisma.allocation.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      amount: true,
      ngoId: true,
      proposalId: true,
      payments: { select: { amount: true } },
    },
  });

  if (!allocation) {
    return NextResponse.json({ error: "Allocation not found" }, { status: 404 });
  }

  const alreadyPaid = paidTotal(allocation.payments);
  const check = checkPayment({
    allocationStatus: allocation.status,
    committed: allocation.amount,
    alreadyPaid,
    amount,
    paidAt,
  });

  if (!check.ok) {
    return NextResponse.json(
      { error: check.message, refusal: check.refusal },
      { status: check.refusal === "ALLOCATION_NOT_APPROVED" ? 409 : 400 },
    );
  }

  // The payment row and its entry on the money log are written together: a
  // confirmation with no entry would be invisible in the transaction history,
  // and an entry with no row would be a claim with no attester behind it.
  let paymentId: string;
  try {
    paymentId = await prisma.$transaction(async (tx) => {
      const payment = await tx.allocationPayment.create({
        data: {
          allocationId: allocation.id,
          amount,
          paidAt,
          reference: reference || null,
          note: note || null,
          recordedById: adminId,
        },
        select: { id: true },
      });

      await tx.ledgerEntry.create({
        data: allocationFundedEntry({
          paymentId: payment.id,
          allocationId: allocation.id,
          ngoId: allocation.ngoId,
          amount,
          reference: reference || null,
          occurredAt: paidAt,
          recordedById: adminId,
        }),
      });

      return payment.id;
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    throw err;
  }

  await logAdminAction({
    adminId,
    action: "ALLOCATION_PAYMENT_RECORDED",
    entityType: "ALLOCATION",
    entityId: allocation.id,
    newValue: { amount: amount.toFixed(2), paidAt: paidAt.toISOString() },
    ...(note ? { note } : {}),
    // The reference is an id a statement can be matched on, not personal data.
    metadata: { paymentId, hasReference: Boolean(reference), proposalId: allocation.proposalId },
    request,
  });

  return NextResponse.json({ id: paymentId }, { status: 201 });
}
