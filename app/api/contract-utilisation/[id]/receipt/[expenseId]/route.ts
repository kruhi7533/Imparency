import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveContractParty } from "@/lib/contract-payments";
import { readPrivateFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — stream an expense receipt from private storage to a party of the contract. Everyone else: 404. */
export async function GET(_request: Request, { params }: { params: { id: string; expenseId: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;
    const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });

    const expense = await prisma.contractExpense.findUnique({ where: { id: params.expenseId } });
    if (!expense || expense.contractId !== params.id || !expense.receiptKey) return notFound;
    const contract = await prisma.contract.findUnique({ where: { id: expense.contractId }, select: { donorId: true, ngoId: true } });
    if (!contract) return notFound;
    if (!(await resolveContractParty({ id: session.user.id, role: session.user.role }, contract))) return notFound;

    const bytes = await readPrivateFile(expense.receiptKey);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": expense.receiptMime ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[api/contract-utilisation/receipt] GET error:", error);
    return NextResponse.json({ error: "Failed to load receipt" }, { status: 500 });
  }
}
