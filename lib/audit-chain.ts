import { createHash, createHmac } from "crypto";
import prisma from "@/lib/prisma";
import { buildAuditWhere, type AuditFilters } from "@/lib/audit-filters";

/**
 * Tamper-evident audit trail (ADM-017 / NEG-013). SERVER ONLY (node crypto).
 *
 * The chain itself is computed by the database: a BEFORE INSERT trigger on
 * AdminActionLog (migration 20261027150000_audit_hash_chain) assigns
 *   seq      = head.seq + 1           (gap-free, serialised by a row lock)
 *   prevHash = head.hash              (64 zeros for the genesis row)
 *   hash     = sha256(canonical(row)) where canonical = jsonb_build_object(...)::text
 * and rejects every UPDATE / DELETE / TRUNCATE. This module:
 *   - reproduces the canonical text in JS so an EXPORTED CSV can be verified
 *     without trusting the server's arithmetic (canonicalAuditText);
 *   - verifies the live chain (verifyAuditChain) — the database recomputes each
 *     row's hash with the same SQL function the trigger used, and the links,
 *     gaps, head and signed checkpoints are checked here;
 *   - writes and checks HMAC-signed head checkpoints (AUDIT_CHAIN_KEY).
 *
 * Threat model: docs/AUDIT-INTEGRITY.md.
 */

export const GENESIS_HASH = "0".repeat(64);

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The fields that are hashed. JSON columns are given as Postgres' jsonb TEXT. */
export interface CanonicalAuditFields {
  seq: number;
  prevHash: string;
  id: string;
  adminId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValueJson: string | null;
  newValueJson: string | null;
  note: string | null;
  metadataJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  schemaVersion: number;
  /** ISO-8601 with milliseconds and Z, e.g. 2026-10-27T13:06:40.054Z */
  createdAt: string;
}

/** A JSON string literal exactly as Postgres' escape_json renders it. */
function jsonString(value: string): string {
  // JSON.stringify escapes ", \, \b \f \n \r \t and other < 0x20 as \u00xx —
  // the same set, in the same form, as Postgres. Lone surrogates (which JS would
  // escape) cannot be stored in Postgres text, so they never reach this.
  return JSON.stringify(value);
}

/**
 * Byte-for-byte the text of `audit_chain_canonical(row)` in SQL.
 *
 * jsonb renders object keys shortest-first, then bytewise, separated by ", "
 * with ": " between key and value. Nested JSON values are embedded verbatim as
 * Postgres rendered them (that is why the export carries `col::text`).
 */
export function canonicalAuditText(f: CanonicalAuditFields): string {
  const str = (v: string | null) => (v === null ? "null" : jsonString(v));
  const json = (v: string | null) => (v === null || v === "" ? "null" : v);
  const entries: Array<[string, string]> = [
    ["v", "1"],
    ["seq", String(f.seq)],
    ["prevHash", str(f.prevHash)],
    ["id", str(f.id)],
    ["adminId", str(f.adminId)],
    ["action", str(f.action)],
    ["entityType", str(f.entityType)],
    ["entityId", str(f.entityId)],
    ["oldValue", json(f.oldValueJson)],
    ["newValue", json(f.newValueJson)],
    ["note", str(f.note)],
    ["metadata", json(f.metadataJson)],
    ["ipAddress", str(f.ipAddress)],
    ["userAgent", str(f.userAgent)],
    ["schemaVersion", String(f.schemaVersion)],
    ["createdAt", str(f.createdAt)],
  ];
  entries.sort(([a], [b]) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, v]) => `${jsonString(k)}: ${v}`).join(", ") + "}";
}

export function auditRowHash(f: CanonicalAuditFields): string {
  return sha256Hex(canonicalAuditText(f));
}

// ---------------------------------------------------------------------------
// Live chain verification
// ---------------------------------------------------------------------------

export type ChainBreakReason =
  | "HASH_MISMATCH" // the row's content no longer matches its stored hash
  | "PREV_MISMATCH" // the row does not link to the previous row's hash
  | "GAP" // a seq is missing — a row was deleted
  | "UNCHAINED_ROW" // a row exists with no seq (written around the trigger)
  | "HEAD_MISMATCH" // the chain tip does not match the recorded head (tail deleted/rewritten)
  | "CHECKPOINT_MISMATCH" // a signed checkpoint no longer matches the row at its seq
  | "CHECKPOINT_SIGNATURE_INVALID"; // a checkpoint's HMAC does not verify

export interface ChainRow {
  id: string;
  seq: number;
  prevHash: string | null;
  hash: string | null;
  /** The hash recomputed now from the row's current content. */
  recomputed: string;
}

export interface ChainBreak {
  seq: number | null;
  id: string | null;
  reason: ChainBreakReason;
  detail: string;
}

/**
 * Walk rows in seq order and report the FIRST break. Pure, so the rules are
 * unit-tested without a database. `expectedSeq`/`expectedPrev` carry state
 * across batches.
 */
export function checkChainSegment(
  rows: ChainRow[],
  state: { expectedSeq: number; expectedPrev: string }
): ChainBreak | null {
  for (const row of rows) {
    if (row.seq !== state.expectedSeq) {
      if (row.seq < state.expectedSeq) {
        // Unreachable with the unique index on seq; reported rather than ignored.
        return { seq: row.seq, id: row.id, reason: "GAP", detail: `seq ${row.seq} out of order (expected ${state.expectedSeq}).` };
      }
      return {
        seq: state.expectedSeq,
        id: null,
        reason: "GAP",
        detail: `Rows ${state.expectedSeq}${row.seq - 1 > state.expectedSeq ? `–${row.seq - 1}` : ""} are missing (next present row is seq ${row.seq}). A row was deleted.`,
      };
    }
    if (row.prevHash !== state.expectedPrev) {
      return { seq: row.seq, id: row.id, reason: "PREV_MISMATCH", detail: `prevHash does not equal the hash of seq ${row.seq - 1}.` };
    }
    if (row.hash !== row.recomputed) {
      return { seq: row.seq, id: row.id, reason: "HASH_MISMATCH", detail: "Row content does not match its stored hash — the row was modified." };
    }
    state.expectedSeq = row.seq + 1;
    state.expectedPrev = row.hash;
  }
  return null;
}

export function checkpointHmac(key: string, seq: number, hash: string): string {
  return createHmac("sha256", key).update(`audit-chain:${seq}:${hash}`, "utf8").digest("hex");
}

export function keyFingerprint(key: string): string {
  return sha256Hex(`fingerprint:${key}`).slice(0, 16);
}

export interface ChainVerification {
  ok: boolean;
  checkedRows: number;
  head: { seq: number; hash: string } | null;
  firstBreak: ChainBreak | null;
  checkpoints: { total: number; signed: number; verified: number; keyConfigured: boolean };
  verifiedAt: string;
}

const BATCH = 2000;

export async function verifyAuditChain(): Promise<ChainVerification> {
  const verifiedAt = new Date().toISOString();
  const headRow = await prisma.auditChainHead.findUnique({ where: { id: 1 } });
  const head = headRow ? { seq: headRow.seq, hash: headRow.hash } : null;
  const key = process.env.AUDIT_CHAIN_KEY || null;
  const checkpointsSummary = { total: 0, signed: 0, verified: 0, keyConfigured: !!key };

  const result = (firstBreak: ChainBreak | null, checkedRows: number): ChainVerification => ({
    ok: firstBreak === null,
    checkedRows,
    head,
    firstBreak,
    checkpoints: checkpointsSummary,
    verifiedAt,
  });

  const unchained = await prisma.adminActionLog.findFirst({ where: { seq: null }, select: { id: true } });
  if (unchained) {
    return result({ seq: null, id: unchained.id, reason: "UNCHAINED_ROW", detail: "A row has no seq — it was written around the chain trigger." }, 0);
  }

  const state = { expectedSeq: 1, expectedPrev: GENESIS_HASH };
  let checked = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<ChainRow[]>`
      SELECT a."id", a."seq", a."prevHash", a."hash", audit_chain_hash(a) AS "recomputed"
      FROM "AdminActionLog" a
      WHERE a."seq" >= ${state.expectedSeq}
      ORDER BY a."seq" ASC
      LIMIT ${BATCH}`;
    if (rows.length === 0) break;
    const brk = checkChainSegment(
      rows.map((r) => ({ ...r, seq: Number(r.seq) })),
      state
    );
    checked += rows.length;
    if (brk) return result(brk, checked);
    if (rows.length < BATCH) break;
  }

  const lastSeq = state.expectedSeq - 1;
  const lastHash = state.expectedPrev;
  if (!head || head.seq !== lastSeq || head.hash !== lastHash) {
    return result(
      {
        seq: head?.seq ?? null,
        id: null,
        reason: "HEAD_MISMATCH",
        detail: `Chain ends at seq ${lastSeq} but the recorded head is seq ${head?.seq ?? "none"}. Rows at the end were deleted or the head was rewritten.`,
      },
      checked
    );
  }

  // Signed checkpoints: each must still match the row at its seq, and its HMAC
  // must verify. This is what catches a wholesale, consistent rewrite of the
  // chain by someone who can run SQL but does not hold AUDIT_CHAIN_KEY.
  const checkpoints = await prisma.auditChainCheckpoint.findMany({ orderBy: { seq: "asc" } });
  checkpointsSummary.total = checkpoints.length;
  for (const cp of checkpoints) {
    if (cp.hmac) checkpointsSummary.signed++;
    const row = cp.seq === 0 ? { hash: GENESIS_HASH } : await prisma.adminActionLog.findUnique({ where: { seq: cp.seq }, select: { hash: true } });
    if (!row || row.hash !== cp.hash) {
      return result({ seq: cp.seq, id: null, reason: "CHECKPOINT_MISMATCH", detail: `Checkpoint ${cp.id} recorded a different hash for seq ${cp.seq}. The chain was rewritten after it was signed.` }, checked);
    }
    if (cp.hmac && key) {
      if (cp.keyFingerprint && cp.keyFingerprint !== keyFingerprint(key)) continue; // signed with a rotated key: cannot judge
      if (checkpointHmac(key, cp.seq, cp.hash) !== cp.hmac) {
        return result({ seq: cp.seq, id: null, reason: "CHECKPOINT_SIGNATURE_INVALID", detail: `Checkpoint ${cp.id} has an invalid signature.` }, checked);
      }
      checkpointsSummary.verified++;
    }
  }

  return result(null, checked);
}

/** Record the current head as a checkpoint, HMAC-signed when AUDIT_CHAIN_KEY is set. */
export async function createAuditCheckpoint(adminId: string | null) {
  const head = await prisma.auditChainHead.findUnique({ where: { id: 1 } });
  const seq = head?.seq ?? 0;
  const hash = head?.hash ?? GENESIS_HASH;
  const key = process.env.AUDIT_CHAIN_KEY || null;
  return prisma.auditChainCheckpoint.create({
    data: {
      seq,
      hash,
      hmac: key ? checkpointHmac(key, seq, hash) : null,
      keyFingerprint: key ? keyFingerprint(key) : null,
      createdById: adminId,
    },
  });
}

// ---------------------------------------------------------------------------
// CSV export / offline verification
// ---------------------------------------------------------------------------

export const AUDIT_CSV_HEADER = [
  "Seq",
  "When",
  "Actor",
  "Actor ID",
  "Action",
  "Entity Type",
  "Entity ID",
  "Note",
  "Old Value",
  "New Value",
  "Metadata",
  "IP Address",
  "User Agent",
  "Schema Version",
  "Record ID",
  "Prev Hash",
  "Hash",
] as const;

/**
 * A CSV cell. Strings are always quoted (RFC 4180); NULL is an empty UNQUOTED
 * cell, so "" (empty string) and NULL hash differently and stay distinguishable.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `"${String(value).replace(/"/g, '""')}"`;
}

export interface ExportRow extends CanonicalAuditFields {
  actorLabel: string;
  hash: string;
}

export function auditCsvLine(r: ExportRow): string {
  return [
    csvCell(r.seq),
    csvCell(r.createdAt),
    csvCell(r.actorLabel),
    csvCell(r.adminId),
    csvCell(r.action),
    csvCell(r.entityType),
    csvCell(r.entityId),
    csvCell(r.note),
    csvCell(r.oldValueJson),
    csvCell(r.newValueJson),
    csvCell(r.metadataJson),
    csvCell(r.ipAddress),
    csvCell(r.userAgent),
    csvCell(r.schemaVersion),
    csvCell(r.id),
    csvCell(r.prevHash),
    csvCell(r.hash),
  ].join(",");
}

export interface ChainHeadLine {
  headSeq: number;
  headHash: string;
  rows: number;
  filtered: boolean;
  truncated: boolean;
  filters: AuditFilters;
  exportedAt: string;
}

export const CHAIN_HEAD_MARKER = "#chain-head";

export function chainHeadCsvLine(h: ChainHeadLine): string {
  return [csvCell(CHAIN_HEAD_MARKER), csvCell(JSON.stringify(h))].join(",");
}

/** One parsed cell: its text, and whether it was quoted (NULL = unquoted empty). */
interface Cell {
  text: string;
  quoted: boolean;
}

/** RFC 4180 parser that keeps quoted-vs-unquoted, with the line each record starts on. */
export function parseCsv(text: string): Array<{ line: number; cells: Cell[] }> {
  const records: Array<{ line: number; cells: Cell[] }> = [];
  let cells: Cell[] = [];
  let cur = "";
  let quoted = false;
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;
  const src = text.replace(/^﻿/, "");
  const pushCell = () => {
    cells.push({ text: cur, quoted });
    cur = "";
    quoted = false;
    fieldStarted = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      quoted = true;
      fieldStarted = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\r") {
      // tolerate CRLF
    } else if (ch === "\n") {
      pushCell();
      if (!(cells.length === 1 && cells[0].text === "" && !cells[0].quoted)) records.push({ line: recordLine, cells });
      cells = [];
      line++;
      recordLine = line;
    } else {
      cur += ch;
      fieldStarted = true;
    }
  }
  if (cur !== "" || quoted || cells.length > 0) {
    pushCell();
    records.push({ line: recordLine, cells });
  }
  return records;
}

export type ExportProblemReason =
  | "BAD_FORMAT"
  | "HASH_MISMATCH" // row content edited in the file
  | "PREV_MISMATCH" // adjacent rows do not link
  | "REORDERED" // seqs not strictly descending
  | "MISSING_ROWS" // a row was removed from the file
  | "NOT_IN_DATABASE" // seq/hash in the file is not what the database holds
  | "HEAD_MISMATCH"; // chain-head line disagrees with the database

export interface ExportProblem {
  line: number | null;
  seq: number | null;
  id: string | null;
  reason: ExportProblemReason;
  detail: string;
}

export interface ExportVerification {
  ok: boolean;
  rowsChecked: number;
  filtered: boolean | null;
  problems: ExportProblem[];
}

/** Hooks into the database, injected so the offline rules are testable alone. */
export interface ExportDbLookup {
  hashesBySeq(seqs: number[]): Promise<Map<number, string>>;
  /** seqs matching the export's filters within [minSeq, maxSeq]. */
  seqsMatching(filters: AuditFilters, minSeq: number, maxSeq: number): Promise<number[]>;
  hashAt(seq: number): Promise<string | null>;
}

const MAX_PROBLEMS = 50;

export async function verifyExportedCsv(text: string, db: ExportDbLookup | null): Promise<ExportVerification> {
  const problems: ExportProblem[] = [];
  const add = (p: ExportProblem) => {
    if (problems.length < MAX_PROBLEMS) problems.push(p);
  };
  const records = parseCsv(text);
  if (records.length === 0 || records[0].cells.map((c) => c.text).join(",") !== AUDIT_CSV_HEADER.join(",")) {
    return { ok: false, rowsChecked: 0, filtered: null, problems: [{ line: 1, seq: null, id: null, reason: "BAD_FORMAT", detail: "Not an audit-trail export with hash-chain columns (header does not match)." }] };
  }

  let headLine: ChainHeadLine | null = null;
  type Parsed = { line: number; fields: CanonicalAuditFields; hash: string };
  const rows: Parsed[] = [];
  const val = (c: Cell | undefined): string | null => (!c || (!c.quoted && c.text === "") ? null : c.text);

  for (const rec of records.slice(1)) {
    if (rec.cells[0]?.text === CHAIN_HEAD_MARKER) {
      try {
        headLine = JSON.parse(rec.cells[1]?.text ?? "");
      } catch {
        add({ line: rec.line, seq: null, id: null, reason: "BAD_FORMAT", detail: "Chain-head line is not readable." });
      }
      continue;
    }
    if (rec.cells.length === 1 && rec.cells[0].text.startsWith("#")) continue; // e.g. the truncation notice
    if (rec.cells.length !== AUDIT_CSV_HEADER.length) {
      add({ line: rec.line, seq: null, id: null, reason: "BAD_FORMAT", detail: `Expected ${AUDIT_CSV_HEADER.length} columns, found ${rec.cells.length}.` });
      continue;
    }
    const c = rec.cells;
    const seq = Number(val(c[0]));
    const schemaVersion = Number(val(c[13]));
    if (!Number.isInteger(seq) || !Number.isInteger(schemaVersion)) {
      add({ line: rec.line, seq: null, id: val(c[14]), reason: "BAD_FORMAT", detail: "Seq or schema version is not a number." });
      continue;
    }
    rows.push({
      line: rec.line,
      hash: val(c[16]) ?? "",
      fields: {
        seq,
        createdAt: val(c[1]) ?? "",
        adminId: val(c[3]),
        action: val(c[4]) ?? "",
        entityType: val(c[5]) ?? "",
        entityId: val(c[6]) ?? "",
        note: val(c[7]),
        oldValueJson: val(c[8]),
        newValueJson: val(c[9]),
        metadataJson: val(c[10]),
        ipAddress: val(c[11]),
        userAgent: val(c[12]),
        schemaVersion,
        id: val(c[14]) ?? "",
        prevHash: val(c[15]) ?? "",
      },
    });
  }

  // 1. Each row against its own hash.
  for (const r of rows) {
    if (auditRowHash(r.fields) !== r.hash) {
      add({ line: r.line, seq: r.fields.seq, id: r.fields.id, reason: "HASH_MISMATCH", detail: "This row's content does not match its hash — it was edited." });
    }
  }
  // 2. Order (export is newest first) and links between adjacent rows.
  for (let i = 1; i < rows.length; i++) {
    const above = rows[i - 1];
    const below = rows[i];
    if (below.fields.seq >= above.fields.seq) {
      add({ line: below.line, seq: below.fields.seq, id: below.fields.id, reason: "REORDERED", detail: `seq ${below.fields.seq} appears after seq ${above.fields.seq}; rows were reordered.` });
      continue;
    }
    if (above.fields.seq === below.fields.seq + 1 && above.fields.prevHash !== below.hash) {
      add({ line: above.line, seq: above.fields.seq, id: above.fields.id, reason: "PREV_MISMATCH", detail: `seq ${above.fields.seq} does not link to seq ${below.fields.seq}.` });
    }
  }
  // 3. Completeness. An unfiltered, untruncated export is the whole chain:
  //    head down to seq 1, contiguous.
  const filtered = headLine ? headLine.filtered : null;
  if (!headLine) {
    add({ line: null, seq: null, id: null, reason: "BAD_FORMAT", detail: "The chain-head line is missing — rows removed from the end cannot be ruled out." });
  } else if (!headLine.filtered && !headLine.truncated) {
    const expectedTop = headLine.headSeq;
    const top = rows[0]?.fields.seq ?? 0;
    if (top !== expectedTop) {
      add({ line: rows[0]?.line ?? null, seq: top, id: rows[0]?.fields.id ?? null, reason: "MISSING_ROWS", detail: `The export's head is seq ${expectedTop} but the newest row in the file is seq ${top}.` });
    }
    if (rows.length > 0 && rows[0].fields.seq === expectedTop && rows[0].hash !== headLine.headHash) {
      add({ line: rows[0].line, seq: expectedTop, id: rows[0].fields.id, reason: "HEAD_MISMATCH", detail: "The newest row's hash is not the head hash recorded in the file." });
    }
    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i - 1].fields.seq - rows[i].fields.seq;
      if (gap > 1) {
        add({ line: rows[i].line, seq: rows[i].fields.seq + 1, id: null, reason: "MISSING_ROWS", detail: gap > 2 ? `Rows ${rows[i].fields.seq + 1}–${rows[i - 1].fields.seq - 1} are missing from the file.` : `Row ${rows[i].fields.seq + 1} is missing from the file.` });
      }
    }
    const bottom = rows[rows.length - 1]?.fields.seq;
    if (bottom !== undefined && bottom !== 1) {
      add({ line: rows[rows.length - 1].line, seq: bottom - 1, id: null, reason: "MISSING_ROWS", detail: `The oldest row in the file is seq ${bottom}; rows 1–${bottom - 1} are missing.` });
    }
  }

  // 4. Against the database: catches a row edited AND re-hashed in the file
  //    (internally consistent, but not what was recorded) and, for filtered
  //    exports, rows deleted from the file.
  if (db && rows.length > 0) {
    const stored = await db.hashesBySeq(rows.map((r) => r.fields.seq));
    for (const r of rows) {
      const h = stored.get(r.fields.seq);
      if (h !== r.hash) {
        add({ line: r.line, seq: r.fields.seq, id: r.fields.id, reason: "NOT_IN_DATABASE", detail: h ? "This row's hash differs from the database's record for this seq." : "No row with this seq exists in the database." });
      }
    }
    if (headLine) {
      const atHead = await db.hashAt(headLine.headSeq);
      if (headLine.headSeq > 0 && atHead !== headLine.headHash) {
        add({ line: null, seq: headLine.headSeq, id: null, reason: "HEAD_MISMATCH", detail: "The chain-head line does not match the database's row at that seq." });
      }
      if (headLine.filtered) {
        const seqs = rows.map((r) => r.fields.seq);
        const expected = await db.seqsMatching(headLine.filters ?? {}, Math.min(...seqs), Math.max(...seqs));
        const present = new Set(seqs);
        const missing = expected.filter((s) => !present.has(s));
        if (missing.length > 0) {
          add({ line: null, seq: missing[0], id: null, reason: "MISSING_ROWS", detail: `${missing.length} row(s) matching the export's filters are missing from the file (first: seq ${missing[0]}).` });
        }
      }
    }
  }

  return { ok: problems.length === 0, rowsChecked: rows.length, filtered, problems };
}

/** The real database lookups for verifyExportedCsv. */
export const prismaExportLookup: ExportDbLookup = {
  async hashesBySeq(seqs) {
    const out = new Map<number, string>();
    for (let i = 0; i < seqs.length; i += 1000) {
      const rows = await prisma.adminActionLog.findMany({ where: { seq: { in: seqs.slice(i, i + 1000) } }, select: { seq: true, hash: true } });
      for (const r of rows) if (r.seq !== null && r.hash) out.set(r.seq, r.hash);
    }
    return out;
  },
  async seqsMatching(filters, minSeq, maxSeq) {
    const rows = await prisma.adminActionLog.findMany({
      where: { AND: [buildAuditWhere(filters), { seq: { gte: minSeq, lte: maxSeq } }] },
      select: { seq: true },
    });
    return rows.map((r) => r.seq).filter((s): s is number => s !== null);
  },
  async hashAt(seq) {
    const row = await prisma.adminActionLog.findUnique({ where: { seq }, select: { hash: true } });
    return row?.hash ?? null;
  },
};
