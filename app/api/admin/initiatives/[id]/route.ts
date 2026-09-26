import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { decryptBankAccountNumber, maskAccountNumber } from "@/lib/crisis/bank-encryption";

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
    try {
      bankAccountNumber = decryptBankAccountNumber(initiative.bankAccountNumberEnc);
    } catch (decErr) {
      console.error(`Failed to decrypt bank account for initiative ${initiative.id}:`, decErr);
      bankAccountNumber = maskAccountNumber("");
    }

    return NextResponse.json({
      initiative: {
        ...initiative,
        requiredFunds: Number(initiative.requiredFunds),
        raisedAmount: Number(initiative.raisedAmount),
        bankAccountNumber,
        bankAccountNumberEnc: undefined,
      },
      _viewedBy: session.user.id,
    });
  } catch (err: any) {
    console.error("Admin initiative detail error:", err);
    return NextResponse.json({ error: "Failed to load initiative" }, { status: 500 });
  }
}
