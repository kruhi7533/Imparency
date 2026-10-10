import crypto from "crypto";
import { Prisma, TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CAN_CONFIRM_PAYMENT } from "@/lib/contract-payments";
import { recordException } from "@/lib/finance-exceptions";

/**
 * Bank-statement matching for contract payments.
 *
 * A donor records a MANUAL contract payment with a reference (UTR / cheque
 * no.). Until now the only way it became RECONCILED was the NGO clicking
 * "confirm" — somebody's word. Here the NGO uploads its bank statement (CSV)
 * and a statement line reconciles a payment only when it carries that
 * payment's reference, for EXACTLY its amount, within a few days of when the
 * donor says it was paid. Anything less certain is left for a human:
 *
 *   MATCHED          one pending payment fits — it is RECONCILED via this line
 *   AMOUNT_MISMATCH  the reference is there, the amount is not (finance queue)
 *   AMBIGUOUS        several payments fit, the dates are too far apart, or one
 *                    payment appears on several lines
 *   UNMATCHED        a credit nothing accounts for — re-checked on every later
 *                    import, in case the donor records the payment afterwards
 *   DEBIT            money going out; never matched
 *
 * Parsing and matching are pure (no database), so the rules are pinned in
 * tests. The platform still moves no money: this only checks evidence.
 */

const dec = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v.toString());

export class BankStatementError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "BankStatementError";
    this.status = status;
  }
}

export const MAX_STATEMENT_BYTES = 1024 * 1024;
export const MAX_STATEMENT_LINES = 5000;
/** How far a bank's value date may drift from the date the donor entered. */
export const MATCH_WINDOW_DAYS = 7;
/** Shorter references are too likely to appear by accident inside other text. */
export const MIN_REFERENCE_LENGTH = 4;

// ─── CSV parsing ──────────────────────────────────────────────────────────────

/** RFC-4180-ish: quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Indian statements are day-first. Returns a UTC-midnight Date or null. */
export function parseStatementDate(raw: string): Date | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[\s\-/]([A-Za-z]{3,9})[\s\-/,]*(\d{2,4})/.exec(s))) {
    const mon = MONTHS[match[2].toLowerCase()] ?? MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    [d, m, y] = [+match[1], mon, +match[3]];
  } else return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? date : null; // rejects 31/02
}

/** "₹1,20,000.00", "1,20,000 Cr", "(500.00)" → Decimal; blank or junk → null. */
export function parseStatementAmount(raw: string): Prisma.Decimal | null {
  const neg = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/₹|rs\.?|inr|cr|dr|[,\s()]/gi, "");
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const v = dec(cleaned);
  return neg ? v.negated() : v;
}

export interface ParsedLine {
  valueDate: Date;
  description: string;
  reference: string | null;
  amount: Prisma.Decimal;
  direction: "CREDIT" | "DEBIT";
}

const H = {
  valueDate: /value\s*date/i,
  date: /date/i,
  description: /narration|description|particulars|remarks|details/i,
  reference: /ref|utr|chq|cheque/i,
  credit: /credit|deposit|^cr\b|cr\s*amount/i,
  debit: /debit|withdrawal|^dr\b|dr\s*amount/i,
  amount: /amount/i,
  type: /^(type|txn\s*type|cr\s*\/\s*dr|dr\s*\/\s*cr)$/i,
};

/**
 * Finds the header row and the columns we need, then reads every transaction.
 * Opening/closing balance rows and anything without a date and an amount are
 * skipped, not guessed at.
 */
export function parseBankStatement(text: string): { lines: ParsedLine[]; skipped: number } {
  const rows = parseCsvRows(text);
  const headerIdx = rows.slice(0, 30).findIndex(
    (r) => r.some((c) => H.date.test(c)) && r.some((c) => H.credit.test(c) || H.amount.test(c))
  );
  if (headerIdx < 0) {
    throw new BankStatementError(
      "Couldn't find the column headers. The CSV needs a Date column and either Credit/Debit columns or an Amount column.",
      400
    );
  }
  const header = rows[headerIdx];
  const col = (re: RegExp, exclude: number[] = []) => header.findIndex((c, i) => re.test(c) && !exclude.includes(i));
  const dateCol = col(H.valueDate) >= 0 ? col(H.valueDate) : col(H.date);
  const descCol = col(H.description);
  // The Cr/Dr *type* column must not be mistaken for a Credit or Debit amount column.
  const typeCol = col(H.type);
  const creditCol = header.findIndex((c, i) => i !== typeCol && H.credit.test(c) && !H.debit.test(c));
  const debitCol = header.findIndex((c, i) => i !== typeCol && H.debit.test(c) && !H.credit.test(c));
  const amountCol = creditCol < 0 ? col(H.amount) : -1;
  const refCol = col(H.reference, [dateCol, descCol, creditCol, debitCol, amountCol, typeCol]);

  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    const valueDate = parseStatementDate(r[dateCol] ?? "");
    let amount: Prisma.Decimal | null = null;
    let direction: "CREDIT" | "DEBIT" = "CREDIT";
    if (creditCol >= 0) {
      const cr = parseStatementAmount(r[creditCol] ?? "");
      const dr = debitCol >= 0 ? parseStatementAmount(r[debitCol] ?? "") : null;
      if (cr && cr.greaterThan(0)) amount = cr;
      else if (dr && dr.greaterThan(0)) [amount, direction] = [dr, "DEBIT"];
    } else if (amountCol >= 0) {
      const raw = r[amountCol] ?? "";
      const a = parseStatementAmount(raw);
      if (a && !a.isZero()) {
        const typeRaw = typeCol >= 0 ? r[typeCol] ?? "" : raw;
        const isDebit = a.isNegative() || /\bdr\b|debit|^d$/i.test(typeRaw.trim());
        [amount, direction] = [a.abs(), isDebit ? "DEBIT" : "CREDIT"];
      }
    }
    if (!valueDate || !amount) {
      skipped++;
      continue;
    }
    lines.push({
      valueDate,
      description: (descCol >= 0 ? r[descCol] : r.filter((_, i) => i !== dateCol).join(" ")).slice(0, 500),
      reference: refCol >= 0 && r[refCol] ? r[refCol].slice(0, 100) : null,
      amount: amount.toDecimalPlaces(2),
      direction,
    });
    if (lines.length > MAX_STATEMENT_LINES) {
      throw new BankStatementError(`The statement has more than ${MAX_STATEMENT_LINES} transactions — upload a shorter date range.`, 400);
    }
  }
  return { lines, skipped };
}

// ─── Matching ────────────────────────────────────────────────────────────────

export const normalizeRef = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export interface MatchLine {
  key: string;
  valueDate: Date;
  amount: Prisma.Decimal | string | number;
  direction: string;
  reference: string | null;
  description: string;
}
export interface MatchPayment {
  id: string;
  amount: Prisma.Decimal | string | number;
  reference: string | null;
  paidAt: Date;
}
export interface MatchDecision {
  status: "MATCHED" | "AMOUNT_MISMATCH" | "AMBIGUOUS" | "UNMATCHED" | "DEBIT";
  note: string;
  matchedPaymentId: string | null;
  candidatePaymentIds: string[];
}

const DAY = 24 * 60 * 60 * 1000;
const inr = (v: Prisma.Decimal | string | number) => `₹${dec(v).toFixed(2)}`;

/**
 * Decides every line. A line MATCHES only when exactly one pending payment's
 * reference appears on it, for exactly its amount, within the date window —
 * and no other line claims that same payment.
 */
export function matchStatementLines(
  lines: MatchLine[],
  payments: MatchPayment[],
  windowDays = MATCH_WINDOW_DAYS
): Map<string, MatchDecision> {
  const usable = payments.filter((p) => normalizeRef(p.reference).length >= MIN_REFERENCE_LENGTH);
  const out = new Map<string, MatchDecision>();

  for (const line of lines) {
    if (line.direction === "DEBIT") {
      out.set(line.key, { status: "DEBIT", note: "Outgoing transaction — not a contract payment.", matchedPaymentId: null, candidatePaymentIds: [] });
      continue;
    }
    const haystack = `${normalizeRef(line.reference)}|${normalizeRef(line.description)}`;
    const candidates = usable.filter((p) => haystack.includes(normalizeRef(p.reference)));
    if (candidates.length === 0) {
      out.set(line.key, { status: "UNMATCHED", note: "No pending contract payment carries a reference found on this line.", matchedPaymentId: null, candidatePaymentIds: [] });
      continue;
    }
    const exact = candidates.filter((p) => dec(p.amount).equals(dec(line.amount)));
    if (exact.length === 0) {
      const p = candidates[0];
      out.set(line.key, {
        status: "AMOUNT_MISMATCH",
        note: `Reference ${p.reference} was recorded for ${inr(p.amount)}, but the statement shows ${inr(line.amount)}.`,
        matchedPaymentId: null,
        candidatePaymentIds: candidates.map((c) => c.id),
      });
      continue;
    }
    const inWindow = exact.filter((p) => Math.abs(line.valueDate.getTime() - new Date(p.paidAt).getTime()) <= windowDays * DAY);
    if (inWindow.length === 1) {
      out.set(line.key, { status: "MATCHED", note: `Reference ${inWindow[0].reference} and amount ${inr(line.amount)} match.`, matchedPaymentId: inWindow[0].id, candidatePaymentIds: [inWindow[0].id] });
    } else if (inWindow.length > 1) {
      out.set(line.key, {
        status: "AMBIGUOUS",
        note: `${inWindow.length} pending payments carry this reference for this amount — confirm the right one on the contract.`,
        matchedPaymentId: null,
        candidatePaymentIds: inWindow.map((c) => c.id),
      });
    } else {
      const days = Math.round(Math.abs(line.valueDate.getTime() - new Date(exact[0].paidAt).getTime()) / DAY);
      out.set(line.key, {
        status: "AMBIGUOUS",
        note: `Reference and amount match, but the dates are ${days} days apart (more than ${windowDays}). Check and confirm on the contract.`,
        matchedPaymentId: null,
        candidatePaymentIds: exact.map((c) => c.id),
      });
    }
  }

  // One payment can be evidenced by one line only. If two lines both claim it,
  // neither wins — a duplicated credit is exactly what a human must look at.
  const claims = new Map<string, string[]>();
  out.forEach((d, key) => {
    if (d.matchedPaymentId) claims.set(d.matchedPaymentId, [...(claims.get(d.matchedPaymentId) ?? []), key]);
  });
  claims.forEach((keys, paymentId) => {
    if (keys.length < 2) return;
    for (const key of keys) {
      out.set(key, {
        status: "AMBIGUOUS",
        note: `This payment appears on ${keys.length} statement lines — check for a duplicate credit.`,
        matchedPaymentId: null,
        candidatePaymentIds: [paymentId],
      });
    }
  });
  return out;
}

/** Content hash for a line, scoped to the NGO; `occurrence` separates identical lines in one file. */
export function statementLineHash(ngoId: string, line: ParsedLine, occurrence: number): string {
  return crypto
    .createHash("sha256")
    .update(
      [ngoId, line.valueDate.toISOString().slice(0, 10), line.amount.toFixed(2), line.direction, normalizeRef(line.reference), normalizeRef(line.description), occurrence].join("|")
    )
    .digest("hex");
}

// ─── Who may upload ──────────────────────────────────────────────────────────

/** The NGO the user acts for, if their role may confirm money (owner, admin, finance). */
export async function resolveNgoFinanceActor(user: { id: string; role: string }): Promise<{ ngoId: string; teamRole: TeamRole } | null> {
  if (user.role !== "NGO") return null;
  const owned = await prisma.nGOProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (owned) return { ngoId: owned.id, teamRole: TeamRole.OWNER };
  const member = await prisma.nGOTeamMember.findFirst({ where: { userId: user.id }, select: { ngoId: true, role: true } });
  return member ? { ngoId: member.ngoId, teamRole: member.role } : null;
}

async function requireFinanceActor(user: { id: string; role: string }) {
  const actor = await resolveNgoFinanceActor(user);
  if (!actor) throw new BankStatementError("Only an NGO's owner, admins or finance team can reconcile bank statements.", 403);
  if (!CAN_CONFIRM_PAYMENT.includes(actor.teamRole)) {
    throw new BankStatementError("Only an NGO's owner, admins or finance team can reconcile bank statements.", 403);
  }
  return actor;
}

// ─── Import + match ──────────────────────────────────────────────────────────

export interface RematchSummary {
  matched: Array<{ paymentId: string; contractId: string; amount: string; reference: string | null }>;
  amountMismatch: number;
  ambiguous: number;
  unmatched: number;
}

/**
 * Re-checks every open credit line of this NGO against its still-pending
 * MANUAL contract payments, and reconciles the clear matches. Safe to run any
 * number of times: a matched line is never re-examined, a payment moves only
 * from PENDING_CONFIRMATION (compare-and-swap), and matchedPaymentId is unique.
 */
export async function rematchNgoStatements(ngoId: string, actorUserId: string, importId?: string): Promise<RematchSummary> {
  const [lines, payments] = await Promise.all([
    prisma.bankStatementLine.findMany({
      where: { ngoId, direction: "CREDIT", status: { in: ["UNMATCHED", "AMBIGUOUS", "AMOUNT_MISMATCH"] } },
      orderBy: [{ valueDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.contractPayment.findMany({
      where: { status: "PENDING_CONFIRMATION", mode: "MANUAL", bankLine: null, contract: { ngoId } },
      select: { id: true, amount: true, reference: true, paidAt: true, contractId: true, contract: { select: { donorId: true, contractNumber: true, projectId: true } } },
    }),
  ]);
  const decisions = matchStatementLines(
    lines.map((l) => ({ key: l.id, valueDate: l.valueDate, amount: l.amount, direction: l.direction, reference: l.reference, description: l.description })),
    payments
  );

  const summary: RematchSummary = { matched: [], amountMismatch: 0, ambiguous: 0, unmatched: 0 };
  const now = new Date();

  for (const line of lines) {
    const d = decisions.get(line.id)!;
    if (d.status === "MATCHED" && d.matchedPaymentId) {
      const payment = payments.find((p) => p.id === d.matchedPaymentId)!;
      const reconciled = await prisma.$transaction(async (tx) => {
        const { count } = await tx.contractPayment.updateMany({
          where: { id: payment.id, status: "PENDING_CONFIRMATION" },
          data: { status: "RECONCILED", confirmedById: actorUserId, confirmedAt: now, reconciledVia: "BANK_STATEMENT" },
        });
        if (count === 0) {
          // Decided by someone else since we read it — leave the line for the next pass.
          await tx.bankStatementLine.update({ where: { id: line.id }, data: { status: "UNMATCHED", note: "The matching payment was decided by someone else meanwhile.", candidatePaymentIds: [] } });
          return false;
        }
        await tx.bankStatementLine.update({
          where: { id: line.id },
          data: { status: "MATCHED", note: d.note, matchedPaymentId: payment.id, candidatePaymentIds: [payment.id] },
        });
        await tx.contractAuditLog.create({
          data: {
            contractId: payment.contractId,
            action: "PAYMENT_RECONCILED",
            actorId: actorUserId,
            actorRole: "NGO",
            detail: `Reconciled against the NGO's bank statement: credit of ₹${dec(line.amount).toFixed(2)} on ${line.valueDate.toISOString().slice(0, 10)} (ref ${payment.reference}).`,
            metadata: { paymentId: payment.id, bankLineId: line.id, via: "BANK_STATEMENT" },
          },
        });
        return true;
      });
      if (reconciled) {
        summary.matched.push({ paymentId: payment.id, contractId: payment.contractId, amount: dec(payment.amount).toFixed(2), reference: payment.reference });
        try {
          await prisma.notification.create({
            data: {
              userId: payment.contract.donorId,
              type: "CONTRACT_PAYMENT_RECONCILED",
              title: "Payment reconciled against the NGO's bank statement",
              body: `Contract ${payment.contract.contractNumber}: ₹${dec(payment.amount).toFixed(2)} (ref ${payment.reference}) was found on the NGO's statement.`,
            },
          });
        } catch (err) {
          console.error("[bank-statement] donor notification failed:", err);
        }
      }
      continue;
    }

    await prisma.bankStatementLine.update({
      where: { id: line.id },
      data: { status: d.status, note: d.note, candidatePaymentIds: d.candidatePaymentIds },
    });
    if (d.status === "AMOUNT_MISMATCH") {
      summary.amountMismatch++;
      const p = payments.find((x) => x.id === d.candidatePaymentIds[0]);
      if (p) {
        // Idempotent per payment: a re-run bumps occurrences, it does not duplicate.
        await recordException({
          type: "BANK_LINE_AMOUNT_MISMATCH",
          entityType: "CONTRACT_PAYMENT",
          entityId: p.id,
          summary: `Bank statement line carries the reference of a contract payment recorded for ${dec(p.amount).toFixed(2)} but shows ${dec(line.amount).toFixed(2)}`,
          expectedAmount: dec(p.amount),
          observedAmount: dec(line.amount),
          detail: { contractId: p.contractId, projectId: p.contract.projectId, bankLineId: line.id },
        }).catch((err) => console.error("[bank-statement] exception queue write failed:", err));
      }
    } else if (d.status === "AMBIGUOUS") summary.ambiguous++;
    else if (d.status === "UNMATCHED") summary.unmatched++;
  }

  if (importId && summary.matched.length > 0) {
    await prisma.bankStatementImport.update({ where: { id: importId }, data: { matchedCount: summary.matched.length } });
  }
  return summary;
}

/** NGO uploads a statement CSV: store its lines (skipping ones seen before), then match. */
export async function importBankStatement(args: { user: { id: string; role: string }; fileName: string; content: string }) {
  const actor = await requireFinanceActor(args.user);
  if (Buffer.byteLength(args.content, "utf8") > MAX_STATEMENT_BYTES) {
    throw new BankStatementError("The statement is larger than 1 MB — upload a shorter date range.", 400);
  }
  const { lines, skipped } = parseBankStatement(args.content);
  if (lines.length === 0) {
    throw new BankStatementError("No transactions were found in this file. Export the statement as CSV with Date, Narration and Credit/Debit (or Amount) columns.", 400);
  }

  const seen = new Map<string, number>();
  const rows = lines.map((l) => {
    const base = statementLineHash(actor.ngoId, l, 0);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { ...l, lineHash: occurrence === 0 ? base : statementLineHash(actor.ngoId, l, occurrence) };
  });

  const imp = await prisma.bankStatementImport.create({
    data: { ngoId: actor.ngoId, uploadedById: args.user.id, fileName: args.fileName.slice(0, 200) || "statement.csv", lineCount: lines.length, newLineCount: 0 },
  });
  const { count } = await prisma.bankStatementLine.createMany({
    data: rows.map((r) => ({
      importId: imp.id,
      ngoId: actor.ngoId,
      valueDate: r.valueDate,
      description: r.description,
      reference: r.reference,
      amount: r.amount,
      direction: r.direction,
      lineHash: r.lineHash,
      status: r.direction === "DEBIT" ? "DEBIT" : "UNMATCHED",
    })),
    skipDuplicates: true,
  });
  await prisma.bankStatementImport.update({ where: { id: imp.id }, data: { newLineCount: count } });

  const summary = await rematchNgoStatements(actor.ngoId, args.user.id, imp.id);
  return { importId: imp.id, lineCount: lines.length, newLines: count, duplicateLines: lines.length - count, skippedRows: skipped, ...summary };
}

/** Re-run matching without a new file — e.g. after a donor records a payment. */
export async function rematchForUser(user: { id: string; role: string }) {
  const actor = await requireFinanceActor(user);
  return rematchNgoStatements(actor.ngoId, user.id);
}

/** Everything the NGO's reconciliation page shows. */
export async function loadReconciliationView(user: { id: string; role: string }) {
  const actor = await resolveNgoFinanceActor(user);
  if (!actor) return null;
  const [imports, lines, pending] = await Promise.all([
    prisma.bankStatementImport.findMany({ where: { ngoId: actor.ngoId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.bankStatementLine.findMany({
      where: { ngoId: actor.ngoId, direction: "CREDIT" },
      orderBy: [{ valueDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: { matchedPayment: { select: { id: true, contractId: true, contract: { select: { contractNumber: true } } } } },
    }),
    prisma.contractPayment.findMany({
      where: { status: "PENDING_CONFIRMATION", mode: "MANUAL", contract: { ngoId: actor.ngoId } },
      orderBy: { paidAt: "desc" },
      select: { id: true, amount: true, reference: true, paidAt: true, contractId: true, contract: { select: { contractNumber: true } }, contractMilestone: { select: { title: true } } },
    }),
  ]);
  return {
    canReconcile: CAN_CONFIRM_PAYMENT.includes(actor.teamRole),
    imports: imports.map((i) => ({ id: i.id, fileName: i.fileName, lineCount: i.lineCount, newLineCount: i.newLineCount, matchedCount: i.matchedCount, createdAt: i.createdAt.toISOString() })),
    lines: lines.map((l) => ({
      id: l.id,
      valueDate: l.valueDate.toISOString(),
      description: l.description,
      reference: l.reference,
      amount: Number(l.amount.toString()),
      status: l.status,
      note: l.note,
      matched: l.matchedPayment ? { paymentId: l.matchedPayment.id, contractId: l.matchedPayment.contractId, contractNumber: l.matchedPayment.contract.contractNumber } : null,
    })),
    pending: pending.map((p) => ({
      id: p.id,
      amount: Number(p.amount.toString()),
      reference: p.reference,
      paidAt: p.paidAt.toISOString(),
      contractId: p.contractId,
      contractNumber: p.contract.contractNumber,
      milestone: p.contractMilestone?.title ?? null,
    })),
  };
}
