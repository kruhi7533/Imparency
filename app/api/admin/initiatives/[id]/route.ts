import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { decryptBankAccountNumber, maskAccountNumber } from "@/lib/crisis/bank-encryption";
import { logAdminAction } from "@/lib/admin-log";

// Bank account number is decrypted here and ONLY here — this is the single
// admin-facing detail view used to cross-check the bank proof document.
// It is never returned by the public /api/crisis/[id]/initiatives list.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole("ADMIN");
    if (!authorized) return response;

    const initiative = await prisma.reliefInitiative.findUnique({
      where: { id: params.id },
      include: {
        crisisEvent: { select: { title: true, slug: true } },
        submittedBy: { select: { name: true, email: true } },
      },
    });
    if (!initiative) return NextResponse.json({ error: "Initiative not found" }, { status: 404 });

    let bankAccountNumber = "";
    let decrypted = true;
    try {
      bankAccountNumber = decryptBankAccountNumber(initiative.bankAccountNumberEnc);
    } catch (decErr) {
      console.error(`Failed to decrypt bank account for initiative ${initiative.id}:`, decErr);
      bankAccountNumber = maskAccountNumber("");
      decrypted = false;
    }

    // A GET, but not an innocent one: this is the only place a bank account
    // number is decrypted, so opening this page discloses it. The read is
    // therefore logged like a disclosure rather than treated as a free lookup —
    // "who has seen this organiser's account number" is a question that has to
    // have an answer. Whether decryption succeeded is recorded too, because a
    // failed decrypt is a key problem someone needs to notice.
    await logAdminAction({
      adminId: session.user.id,
      action: "INITIATIVE_BANK_DETAILS_VIEWED",
      entityType: "RELIEF_INITIATIVE",
      entityId: initiative.id,
      note: "Viewed decrypted bank details to cross-check the bank proof document",
      metadata: { decrypted },
      request,
    });

    return NextResponse.json({
      initiative: {
        ...initiative,
        requiredFunds: Number(initiative.requiredFunds),
        raisedAmount: Number(initiative.raisedAmount),
        bankAccountNumber,
        bankAccountNumberEnc: undefined,
      },
    });
  } catch (err: any) {
    console.error("Admin initiative detail error:", err);
    return NextResponse.json({ error: "Failed to load initiative" }, { status: 500 });
  }
}
