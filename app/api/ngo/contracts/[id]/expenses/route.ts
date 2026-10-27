import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveNgoActor } from "@/lib/field-evidence";
import { uploadPrivateFile, deletePrivateFile } from "@/lib/storage";
import { CAN_RECORD_EXPENSE, MAX_RECEIPT_BYTES, exceedsAllocation, parseExpense, sniffReceipt } from "@/lib/contract-expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(e: any) {
  return {
    id: e.id,
    contractMilestoneId: e.contractMilestoneId,
    amount: e.amount.toFixed(2),
    category: e.category,
    description: e.description,
    spentOn: e.spentOn.toISOString(),
    hasReceipt: !!e.receiptKey,
    createdAt: e.createdAt.toISOString(),
  };
}

async function loadContract(contractId: string, userId: string) {
  const actor = await resolveNgoActor(userId);
  if (!actor) return { error: NextResponse.json({ error: "No NGO membership" }, { status: 403 }) };
  const contract = await prisma.contract.findUnique({ where: { id: contractId }, select: { id: true, ngoId: true, status: true } });
  if (!contract) return { error: NextResponse.json({ error: "Contract not found" }, { status: 404 }) };
  if (contract.ngoId !== actor.ngoId) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { actor, contract };
}

/** GET — expenses recorded on this contract (the NGO's own). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const r = await loadContract(params.id, session.user.id);
    if ("error" in r) return r.error;
    const rows = await prisma.contractExpense.findMany({ where: { contractId: r.contract.id }, orderBy: { spentOn: "desc" } });
    return NextResponse.json({ expenses: rows.map(serialize), canRecord: CAN_RECORD_EXPENSE.includes(r.actor.teamRole) });
  } catch (error) {
    console.error("[api/ngo/contracts/[id]/expenses] GET error:", error);
    return NextResponse.json({ error: "Failed to load expenses" }, { status: 500 });
  }
}

/**
 * POST multipart: contractMilestoneId, amount, category, description, spentOn,
 * idempotencyKey, receipt? (PDF/JPEG/PNG/WebP, ≤10 MB, private storage).
 *
 * Idempotent on idempotencyKey: a replay returns the stored expense (200,
 * replayed) and uploads nothing. A milestone's recorded spend may not exceed
 * its allocation (422); the check and insert hold a row lock on the milestone
 * so two concurrent posts cannot both squeeze under the limit.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let uploadedKey: string | null = null;
  try {
    const { authorized, response, session } = await verifySessionRole(Role.NGO);
    if (!authorized) return response;
    const r = await loadContract(params.id, session.user.id);
    if ("error" in r) return r.error;
    if (!CAN_RECORD_EXPENSE.includes(r.actor.teamRole)) {
      return NextResponse.json({ error: "Only an owner, admin or finance member can record expenses." }, { status: 403 });
    }
    if (r.contract.status !== "ACTIVE" && r.contract.status !== "COMPLETED") {
      return NextResponse.json({ error: `Expenses can be recorded only on an ACTIVE or COMPLETED contract; this one is ${r.contract.status}.` }, { status: 409 });
    }

    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
    const fields: Record<string, unknown> = {};
    for (const k of ["contractMilestoneId", "amount", "category", "description", "spentOn", "idempotencyKey"]) fields[k] = form.get(k);
    const parsed = parseExpense(fields);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const v = parsed.value;

    const existing = await prisma.contractExpense.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
    if (existing) {
      if (existing.contractId !== r.contract.id) return NextResponse.json({ error: "idempotencyKey already used" }, { status: 409 });
      return NextResponse.json({ expense: serialize(existing), replayed: true });
    }

    const milestone = await prisma.contractMilestone.findUnique({ where: { id: v.contractMilestoneId }, select: { id: true, contractId: true } });
    if (!milestone || milestone.contractId !== r.contract.id) return NextResponse.json({ error: "Milestone not found on this contract" }, { status: 404 });

    let receiptMime: string | null = null;
    const receipt = form.get("receipt");
    if (receipt && typeof receipt !== "string" && (receipt as File).size > 0) {
      const file = receipt as File;
      if (file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: "Receipt exceeds 10 MB" }, { status: 400 });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniffReceipt(bytes);
      if (!kind) return NextResponse.json({ error: "Receipt must be a PDF, JPEG, PNG or WebP file" }, { status: 400 });
      uploadedKey = await uploadPrivateFile(Buffer.from(bytes), kind.ext, "expense-receipts");
      receiptMime = kind.mime;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ContractMilestone" WHERE id = ${milestone.id} FOR UPDATE`;
      const m = await tx.contractMilestone.findUnique({ where: { id: milestone.id }, select: { allocatedAmount: true } });
      const agg = await tx.contractExpense.aggregate({ where: { contractMilestoneId: milestone.id }, _sum: { amount: true } });
      if (exceedsAllocation(m!.allocatedAmount, agg._sum.amount ?? "0", v.amount)) return { overspend: true as const };
      const created = await tx.contractExpense.create({
        data: {
          contractId: r.contract.id,
          contractMilestoneId: milestone.id,
          ngoId: r.contract.ngoId,
          amount: v.amount,
          category: v.category,
          description: v.description,
          spentOn: v.spentOn,
          receiptKey: uploadedKey,
          receiptMime,
          idempotencyKey: v.idempotencyKey,
          recordedById: session.user.id,
        },
      });
      return { overspend: false as const, created };
    });

    if (result.overspend) {
      if (uploadedKey) await deletePrivateFile(uploadedKey).catch(() => {});
      return NextResponse.json({ error: "This expense would take the milestone's recorded spend above its allocated amount." , code: "EXCEEDS_ALLOCATION" }, { status: 422 });
    }
    return NextResponse.json({ expense: serialize(result.created) }, { status: 201 });
  } catch (error: any) {
    if (uploadedKey) await deletePrivateFile(uploadedKey).catch(() => {});
    if (error?.code === "P2002") {
      // A concurrent submit with the same idempotencyKey won the race. Same outcome.
      return NextResponse.json({ error: "This expense was already recorded. Reload to see it.", replayed: true }, { status: 409 });
    }
    console.error("[api/ngo/contracts/[id]/expenses] POST error:", error);
    return NextResponse.json({ error: "Failed to record expense" }, { status: 500 });
  }
}
