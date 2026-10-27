import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveContractParty } from "@/lib/contract-payments";
import { computeUtilisation } from "@/lib/contract-expenses";

export const dynamic = "force-dynamic";

/**
 * GET /api/contract-utilisation/[id] — read-only utilisation for any party to
 * the contract (the NGO, the donor account incl. its team, an admin). Per
 * milestone: allocated, received (RECONCILED payments), spent (expenses), and
 * spent as a % of each. Anyone else: 404.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;
    const contract = await prisma.contract.findUnique({ where: { id: params.id }, select: { id: true, donorId: true, ngoId: true } });
    if (!contract) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const party = await resolveContractParty({ id: session.user.id, role: session.user.role }, contract);
    if (!party) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [milestones, payments, expenses] = await Promise.all([
      prisma.contractMilestone.findMany({ where: { contractId: contract.id }, orderBy: { orderIndex: "asc" }, select: { id: true, title: true, allocatedAmount: true } }),
      prisma.contractPayment.findMany({ where: { contractId: contract.id }, select: { contractMilestoneId: true, amount: true, status: true } }),
      prisma.contractExpense.findMany({ where: { contractId: contract.id }, orderBy: { spentOn: "desc" } }),
    ]);
    return NextResponse.json({
      party: party.party,
      ...computeUtilisation(milestones, payments, expenses),
      expenses: expenses.map((e) => ({
        id: e.id,
        contractMilestoneId: e.contractMilestoneId,
        amount: e.amount.toFixed(2),
        category: e.category,
        description: e.description,
        spentOn: e.spentOn.toISOString(),
        hasReceipt: !!e.receiptKey,
      })),
    });
  } catch (error) {
    console.error("[api/contract-utilisation/[id]] GET error:", error);
    return NextResponse.json({ error: "Failed to load utilisation" }, { status: 500 });
  }
}
