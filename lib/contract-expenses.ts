import { Prisma, TeamRole, type ExpenseCategory } from "@prisma/client";

/**
 * NGO expense / utilisation recording per contract milestone (NGO-015).
 * Pure: parsing, limits and the utilisation arithmetic. Money is Decimal end
 * to end; percentages are computed from Decimals and only then rounded.
 */

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "PERSONNEL",
  "MATERIALS",
  "TRAVEL",
  "EQUIPMENT",
  "TRAINING",
  "ADMINISTRATIVE",
  "OTHER",
];

/** Recording spend is a finance act — field staff cannot. */
export const CAN_RECORD_EXPENSE: TeamRole[] = [TeamRole.OWNER, TeamRole.ADMIN, TeamRole.FINANCE];

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export interface ParsedExpense {
  contractMilestoneId: string;
  amount: Prisma.Decimal;
  category: ExpenseCategory;
  description: string;
  spentOn: Date;
  idempotencyKey: string;
}

export function parseExpense(f: Record<string, unknown>, now: Date = new Date()): { ok: true; value: ParsedExpense } | { ok: false; error: string } {
  const s = (k: string) => (typeof f[k] === "string" ? (f[k] as string).trim() : "");
  const contractMilestoneId = s("contractMilestoneId");
  if (!contractMilestoneId) return { ok: false, error: "contractMilestoneId is required" };
  const amountStr = s("amount");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amountStr)) return { ok: false, error: "amount must be a positive number with at most 2 decimals" };
  const amount = new Prisma.Decimal(amountStr);
  if (amount.lte(0)) return { ok: false, error: "amount must be positive" };
  const category = s("category") as ExpenseCategory;
  if (!EXPENSE_CATEGORIES.includes(category)) return { ok: false, error: "category is not recognised" };
  const description = s("description").slice(0, 1000);
  if (!description) return { ok: false, error: "description is required" };
  const spentOn = new Date(s("spentOn"));
  if (!s("spentOn") || Number.isNaN(spentOn.getTime())) return { ok: false, error: "spentOn must be a date" };
  if (spentOn.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return { ok: false, error: "spentOn cannot be in the future" };
  const idempotencyKey = s("idempotencyKey");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) return { ok: false, error: "idempotencyKey is required (8-100 url-safe chars)" };
  return { ok: true, value: { contractMilestoneId, amount, category, description, spentOn, idempotencyKey } };
}

function ascii(b: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i++) out += String.fromCharCode(b[i]);
  return out;
}

/** PDF or image receipts, identified by magic bytes rather than the client's MIME claim. */
export function sniffReceipt(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return { mime: "application/pdf", ext: ".pdf" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: ".png" };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: ".webp" };
  }
  return null;
}

/** Would this expense take the milestone's recorded spend above its allocation? */
export function exceedsAllocation(allocated: Prisma.Decimal | string, alreadySpent: Prisma.Decimal | string, amount: Prisma.Decimal): boolean {
  return new Prisma.Decimal(alreadySpent).plus(amount).gt(new Prisma.Decimal(allocated));
}

/** spent / base as a whole percent; null when there is no base (never a fake 0%). */
export function percentOf(spent: Prisma.Decimal, base: Prisma.Decimal): number | null {
  if (base.lte(0)) return null;
  return Number(spent.div(base).times(100).toDecimalPlaces(1).toString());
}

export interface MilestoneUtilisation {
  milestoneId: string;
  title: string;
  allocated: string;
  received: string;
  spent: string;
  utilisationOfReceived: number | null;
  utilisationOfAllocated: number | null;
}

export function computeUtilisation(
  milestones: { id: string; title: string; allocatedAmount: Prisma.Decimal | string }[],
  payments: { contractMilestoneId: string | null; amount: Prisma.Decimal | string; status: string }[],
  expenses: { contractMilestoneId: string; amount: Prisma.Decimal | string }[],
) {
  const D = (v: Prisma.Decimal | string) => new Prisma.Decimal(v);
  let tA = D("0"), tR = D("0"), tS = D("0");
  const rows: MilestoneUtilisation[] = milestones.map((m) => {
    const allocated = D(m.allocatedAmount);
    // "Funded" = money the NGO confirmed arrived. Unconfirmed or disputed payments do not count.
    const received = payments
      .filter((p) => p.contractMilestoneId === m.id && p.status === "RECONCILED")
      .reduce((a, p) => a.plus(D(p.amount)), D("0"));
    const spent = expenses.filter((e) => e.contractMilestoneId === m.id).reduce((a, e) => a.plus(D(e.amount)), D("0"));
    tA = tA.plus(allocated); tR = tR.plus(received); tS = tS.plus(spent);
    return {
      milestoneId: m.id,
      title: m.title,
      allocated: allocated.toFixed(2),
      received: received.toFixed(2),
      spent: spent.toFixed(2),
      utilisationOfReceived: percentOf(spent, received),
      utilisationOfAllocated: percentOf(spent, allocated),
    };
  });
  // Contract-level payments not tied to a milestone still count as funding received.
  const unassigned = payments.filter((p) => !p.contractMilestoneId && p.status === "RECONCILED").reduce((a, p) => a.plus(D(p.amount)), D("0"));
  tR = tR.plus(unassigned);
  return {
    milestones: rows,
    totals: {
      allocated: tA.toFixed(2),
      received: tR.toFixed(2),
      spent: tS.toFixed(2),
      utilisationOfReceived: percentOf(tS, tR),
      utilisationOfAllocated: percentOf(tS, tA),
    },
  };
}
