import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { recordContractPaymentDispute } from "@/lib/finance-exceptions";
import {
  CAN_CONFIRM_PAYMENT,
  checkDecision,
  isPaymentDecision,
  resolveContractParty,
} from "@/lib/contract-payments";

/**
 * The NGO confirms a donor-recorded payment arrived (RECONCILED) or disputes it
 * (DISPUTED, with a note, and a finance exception an admin will see).
 *
 * Body: { decision: "CONFIRM" | "DISPUTE", note? }
 */
export async function PATCH(request: Request, { params }: { params: { id: string; paymentId: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;

    const payment = await prisma.contractPayment.findUnique({
      where: { id: params.paymentId },
      include: { contract: { select: { id: true, donorId: true, ngoId: true, projectId: true } } },
    });
    // A payment id under another contract's URL is a 404, not a way in.
    if (!payment || payment.contractId !== params.id) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    const party = await resolveContractParty(session.user, payment.contract);
    if (!party || party.party !== "NGO") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!CAN_CONFIRM_PAYMENT.includes(party.teamRole)) {
      return NextResponse.json({ error: "Only NGO owners, admins or finance can confirm payments." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    if (!isPaymentDecision(body.decision)) {
      return NextResponse.json({ error: "decision must be CONFIRM or DISPUTE." }, { status: 400 });
    }

    const check = checkDecision(payment.status, body.decision, body.note);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (check.noop) return NextResponse.json({ payment, replayed: true });

    const note = body.decision === "DISPUTE" ? String(body.note).trim().slice(0, 500) : null;
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      // Only a still-pending payment moves. A concurrent decision loses here.
      const { count } = await tx.contractPayment.updateMany({
        where: { id: payment.id, status: "PENDING_CONFIRMATION" },
        data: { status: check.target, confirmedById: session.user.id, confirmedAt: now, disputeNote: note },
      });
      if (count === 0) return null;
      await tx.contractAuditLog.create({
        data: {
          contractId: payment.contractId,
          action: body.decision === "CONFIRM" ? "PAYMENT_RECONCILED" : "PAYMENT_DISPUTED",
          actorId: session.user.id,
          actorRole: "NGO",
          detail:
            body.decision === "CONFIRM"
              ? `NGO confirmed receipt of ₹${payment.amount.toFixed(2)}.`
              : `NGO disputed a payment of ₹${payment.amount.toFixed(2)}: ${note}`,
          metadata: { paymentId: payment.id },
        },
      });
      return tx.contractPayment.findUnique({ where: { id: payment.id } });
    });

    if (!updated) {
      return NextResponse.json({ error: "This payment was decided by someone else just now. Refresh." }, { status: 409 });
    }

    if (body.decision === "DISPUTE") {
      // Outside the transaction: the dispute stands even if the queue write
      // fails, and the queue write is itself idempotent per payment.
      await recordContractPaymentDispute({
        paymentId: payment.id,
        contractId: payment.contractId,
        projectId: payment.contract.projectId,
        amount: payment.amount,
      }).catch((err) => console.error("[contract payment dispute] exception queue write failed:", err));
    }

    return NextResponse.json({ payment: updated });
  } catch (error) {
    console.error("[api/contracts/[id]/payments/[paymentId]] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update payment" }, { status: 500 });
  }
}
