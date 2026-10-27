import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ADM-017 / NEG-013 — the tamper-evident audit trail.
 *
 * The chain is computed by a Postgres trigger (migration
 * 20261027150000_audit_hash_chain). These tests pin:
 *  - the JS canonical form reproduces the database's byte-for-byte (fixtures
 *    below were produced by the real trigger on Postgres 18), so an exported
 *    CSV can be verified offline;
 *  - the chain walker reports the FIRST break and why;
 *  - upload-to-verify detects an edited, deleted, reordered, and edited-and-
 *    rehashed row;
 *  - the routes are admin-only and audited.
 */

const db = vi.hoisted(() => ({
  adminActionLog: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  auditChainHead: { findUnique: vi.fn() },
  auditChainCheckpoint: { findMany: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import { getServerSession } from "next-auth/next";
import {
  GENESIS_HASH,
  auditCsvLine,
  auditRowHash,
  canonicalAuditText,
  chainHeadCsvLine,
  checkChainSegment,
  checkpointHmac,
  verifyAuditChain,
  verifyExportedCsv,
  AUDIT_CSV_HEADER,
  type CanonicalAuditFields,
  type ExportDbLookup,
} from "@/lib/audit-chain";
import { GET as VERIFY } from "@/app/api/admin/audit/verify/route";
import { POST as VERIFY_EXPORT } from "@/app/api/admin/audit/verify-export/route";
import { POST as CHECKPOINT } from "@/app/api/admin/audit/checkpoint/route";

const session = getServerSession as any;

// Produced by the real trigger: INSERT ... ('t-1','TEST','SYSTEM','x','{"b":1.50,"a":"é\\n"}','hi').
const ROW1: CanonicalAuditFields = {
  seq: 1,
  prevHash: GENESIS_HASH,
  id: "t-1",
  adminId: null,
  action: "TEST",
  entityType: "SYSTEM",
  entityId: "x",
  oldValueJson: '{"a": "é\\\\n", "b": 1.50}',
  newValueJson: null,
  note: "hi",
  metadataJson: null,
  ipAddress: null,
  userAgent: null,
  schemaVersion: 1,
  createdAt: "2026-10-27T13:06:40.054Z",
};
const ROW1_HASH = "2e900c90d51666c62476db0b6ec9eff76cd99d33a2bcbdfea8ac81aa54a000e7";
const ROW2: CanonicalAuditFields = { ...ROW1, seq: 2, prevHash: ROW1_HASH, id: "t-2", entityId: "y", oldValueJson: null, note: null };
const ROW2_HASH = "777d23a90a63c7d93d5655c6c150feb35477c71fc7b50276a3c9d857edda549f";

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockReset(); // drop any queued once-values a short-circuited test left behind
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
});
afterEach(() => {
  delete process.env.AUDIT_CHAIN_KEY;
});

describe("canonical serialisation matches Postgres", () => {
  it("renders keys in jsonb order (length, then bytewise) with jsonb spacing", () => {
    expect(canonicalAuditText(ROW1)).toBe(
      '{"v": 1, "id": "t-1", "seq": 1, "note": "hi", "action": "TEST", "adminId": null, "entityId": "x", "metadata": null, "newValue": null, "oldValue": {"a": "é\\\\n", "b": 1.50}, "prevHash": "' +
        GENESIS_HASH +
        '", "createdAt": "2026-10-27T13:06:40.054Z", "ipAddress": null, "userAgent": null, "entityType": "SYSTEM", "schemaVersion": 1}'
    );
  });

  it("hashes to exactly what the database trigger stored", () => {
    expect(auditRowHash(ROW1)).toBe(ROW1_HASH);
    expect(auditRowHash(ROW2)).toBe(ROW2_HASH);
  });

  it("any field change changes the hash", () => {
    expect(auditRowHash({ ...ROW1, note: "hi!" })).not.toBe(ROW1_HASH);
    expect(auditRowHash({ ...ROW1, note: "" })).not.toBe(auditRowHash({ ...ROW1, note: null }));
  });
});

describe("checkChainSegment — first break and why", () => {
  const rows = () => [
    { id: "t-1", seq: 1, prevHash: GENESIS_HASH, hash: ROW1_HASH, recomputed: ROW1_HASH },
    { id: "t-2", seq: 2, prevHash: ROW1_HASH, hash: ROW2_HASH, recomputed: ROW2_HASH },
  ];
  const fresh = () => ({ expectedSeq: 1, expectedPrev: GENESIS_HASH });

  it("an intact chain has no break", () => {
    expect(checkChainSegment(rows(), fresh())).toBeNull();
  });
  it("a modified row is HASH_MISMATCH at its seq", () => {
    const r = rows();
    r[1].recomputed = "b".repeat(64);
    expect(checkChainSegment(r, fresh())).toMatchObject({ seq: 2, id: "t-2", reason: "HASH_MISMATCH" });
  });
  it("a deleted row is a GAP at the missing seq", () => {
    const r = rows();
    expect(checkChainSegment([r[1]], fresh())).toMatchObject({ seq: 1, reason: "GAP" });
  });
  it("a relinked row is PREV_MISMATCH", () => {
    const r = rows();
    r[1].prevHash = "c".repeat(64);
    expect(checkChainSegment(r, fresh())).toMatchObject({ seq: 2, reason: "PREV_MISMATCH" });
  });
});

describe("verifyAuditChain", () => {
  beforeEach(() => {
    db.adminActionLog.findFirst.mockResolvedValue(null);
    db.auditChainCheckpoint.findMany.mockResolvedValue([]);
    db.auditChainHead.findUnique.mockResolvedValue({ id: 1, seq: 2, hash: ROW2_HASH });
    db.$queryRaw.mockResolvedValueOnce([
      { id: "t-1", seq: 1, prevHash: GENESIS_HASH, hash: ROW1_HASH, recomputed: ROW1_HASH },
      { id: "t-2", seq: 2, prevHash: ROW1_HASH, hash: ROW2_HASH, recomputed: ROW2_HASH },
    ]);
  });

  it("reports OK for an intact chain", async () => {
    const res = await verifyAuditChain();
    expect(res).toMatchObject({ ok: true, checkedRows: 2, firstBreak: null });
  });

  it("detects deletion of the newest row (head no longer matches)", async () => {
    db.auditChainHead.findUnique.mockResolvedValue({ id: 1, seq: 3, hash: "d".repeat(64) });
    const res = await verifyAuditChain();
    expect(res.ok).toBe(false);
    expect(res.firstBreak?.reason).toBe("HEAD_MISMATCH");
  });

  it("detects a row written around the trigger", async () => {
    db.adminActionLog.findFirst.mockResolvedValue({ id: "rogue" });
    const res = await verifyAuditChain();
    expect(res.firstBreak).toMatchObject({ reason: "UNCHAINED_ROW", id: "rogue" });
  });

  it("a signed checkpoint that no longer matches its row reveals a whole-chain rewrite", async () => {
    process.env.AUDIT_CHAIN_KEY = "k";
    db.auditChainCheckpoint.findMany.mockResolvedValue([
      { id: "cp1", seq: 1, hash: "e".repeat(64), hmac: checkpointHmac("k", 1, "e".repeat(64)), keyFingerprint: null },
    ]);
    db.adminActionLog.findUnique.mockResolvedValue({ hash: ROW1_HASH });
    const res = await verifyAuditChain();
    expect(res.firstBreak).toMatchObject({ reason: "CHECKPOINT_MISMATCH", seq: 1 });
  });

  it("a forged checkpoint signature is reported", async () => {
    process.env.AUDIT_CHAIN_KEY = "k";
    db.auditChainCheckpoint.findMany.mockResolvedValue([{ id: "cp1", seq: 1, hash: ROW1_HASH, hmac: "00", keyFingerprint: null }]);
    db.adminActionLog.findUnique.mockResolvedValue({ hash: ROW1_HASH });
    const res = await verifyAuditChain();
    expect(res.firstBreak?.reason).toBe("CHECKPOINT_SIGNATURE_INVALID");
  });

  it("a valid signed checkpoint verifies", async () => {
    process.env.AUDIT_CHAIN_KEY = "k";
    db.auditChainCheckpoint.findMany.mockResolvedValue([{ id: "cp1", seq: 1, hash: ROW1_HASH, hmac: checkpointHmac("k", 1, ROW1_HASH), keyFingerprint: null }]);
    db.adminActionLog.findUnique.mockResolvedValue({ hash: ROW1_HASH });
    const res = await verifyAuditChain();
    expect(res.ok).toBe(true);
    expect(res.checkpoints).toMatchObject({ total: 1, signed: 1, verified: 1 });
  });
});

// ── exported CSV ──────────────────────────────────────────────────────────────

function chainOf(n: number): Array<CanonicalAuditFields & { hash: string }> {
  const out: Array<CanonicalAuditFields & { hash: string }> = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const f: CanonicalAuditFields = {
      ...ROW1,
      seq: i,
      prevHash: prev,
      id: `r-${i}`,
      note: `note ${i}, with "quotes"\nand a newline`,
      oldValueJson: i === 2 ? '{"status": "PENDING"}' : null,
      createdAt: `2026-10-27T10:00:0${i}.000Z`,
    };
    const hash = auditRowHash(f);
    out.push({ ...f, hash });
    prev = hash;
  }
  return out;
}

function exportCsv(rows: Array<CanonicalAuditFields & { hash: string }>, opts: { filtered?: boolean; head?: { seq: number; hash: string } } = {}) {
  const desc = [...rows].sort((a, b) => b.seq - a.seq);
  const head = opts.head ?? { seq: desc[0].seq, hash: desc[0].hash };
  return [
    AUDIT_CSV_HEADER.join(","),
    ...desc.map((r) => auditCsvLine({ ...r, actorLabel: "Platform" })),
    chainHeadCsvLine({ headSeq: head.seq, headHash: head.hash, rows: desc.length, filtered: !!opts.filtered, truncated: false, filters: {}, exportedAt: "2026-10-27T11:00:00.000Z" }),
  ].join("\n");
}

function lookup(rows: Array<{ seq: number; hash: string }>, matching?: number[]): ExportDbLookup {
  return {
    hashesBySeq: async (seqs) => new Map(rows.filter((r) => seqs.includes(r.seq)).map((r) => [r.seq, r.hash])),
    seqsMatching: async (_f, min, max) => (matching ?? rows.map((r) => r.seq)).filter((s) => s >= min && s <= max),
    hashAt: async (seq) => rows.find((r) => r.seq === seq)?.hash ?? null,
  };
}

describe("verifyExportedCsv — NEG-013", () => {
  const rows = chainOf(4);

  it("an untouched export verifies offline and against the database", async () => {
    expect(await verifyExportedCsv(exportCsv(rows), null)).toMatchObject({ ok: true, rowsChecked: 4 });
    expect(await verifyExportedCsv(exportCsv(rows), lookup(rows))).toMatchObject({ ok: true, rowsChecked: 4 });
  });

  it("an edited cell is HASH_MISMATCH on that row", async () => {
    const csv = exportCsv(rows).replace('"note 3, with', '"NOTE 3, with');
    const res = await verifyExportedCsv(csv, null);
    expect(res.ok).toBe(false);
    expect(res.problems[0]).toMatchObject({ reason: "HASH_MISMATCH", seq: 3 });
  });

  it("a deleted row is MISSING_ROWS", async () => {
    const res = await verifyExportedCsv(exportCsv(rows.filter((r) => r.seq !== 2)), null);
    expect(res.problems.some((p) => p.reason === "MISSING_ROWS" && p.seq === 2)).toBe(true);
  });

  it("a deleted newest row is caught by the chain-head line", async () => {
    const res = await verifyExportedCsv(exportCsv(rows.slice(0, 3), { head: { seq: 4, hash: rows[3].hash } }), null);
    expect(res.problems.some((p) => p.reason === "MISSING_ROWS")).toBe(true);
  });

  it("reordered rows are REORDERED", async () => {
    const lines = exportCsv(rows).split("\n");
    // Swap the records for seq 3 and seq 2 — each record spans two physical lines (the note has a newline).
    const header = lines[0];
    const recs: string[] = [];
    for (let i = 1; i < lines.length - 1; i += 2) recs.push(lines[i] + "\n" + lines[i + 1]);
    [recs[1], recs[2]] = [recs[2], recs[1]];
    const csv = [header, ...recs, lines[lines.length - 1]].join("\n");
    const res = await verifyExportedCsv(csv, null);
    expect(res.problems.some((p) => p.reason === "REORDERED")).toBe(true);
  });

  it("an edited AND re-hashed row passes offline but fails against the database", async () => {
    const forged = rows.map((r) => ({ ...r }));
    forged[3] = { ...forged[3], note: "forged" };
    forged[3].hash = auditRowHash(forged[3]);
    const csv = exportCsv(forged);
    const res = await verifyExportedCsv(csv, lookup(rows));
    expect(res.ok).toBe(false);
    expect(res.problems.some((p) => p.reason === "NOT_IN_DATABASE" && p.seq === 4)).toBe(true);
  });

  it("a row removed from a FILTERED export is found by re-running its filters", async () => {
    const subset = rows.filter((r) => r.seq === 1 || r.seq === 4);
    const res = await verifyExportedCsv(exportCsv(subset, { filtered: true, head: { seq: 4, hash: rows[3].hash } }), lookup(rows, [1, 3, 4]));
    expect(res.problems.some((p) => p.reason === "MISSING_ROWS" && p.seq === 3)).toBe(true);
  });

  it("a file that is not an audit export is BAD_FORMAT", async () => {
    const res = await verifyExportedCsv("a,b\n1,2", null);
    expect(res.problems[0].reason).toBe("BAD_FORMAT");
  });
});

describe("routes", () => {
  it("verify is refused for a non-admin and reads nothing", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await VERIFY(new Request("http://localhost/api/admin/audit/verify"));
    expect(res.status).toBe(403);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("verify returns the verdict and is itself audited with ids only", async () => {
    db.adminActionLog.findFirst.mockResolvedValue(null);
    db.auditChainHead.findUnique.mockResolvedValue({ id: 1, seq: 0, hash: GENESIS_HASH });
    db.auditChainCheckpoint.findMany.mockResolvedValue([]);
    db.$queryRaw.mockResolvedValue([]);
    const res = await VERIFY(new Request("http://localhost/api/admin/audit/verify"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const logged = db.adminActionLog.create.mock.calls[0][0].data;
    expect(logged.action).toBe("AUDIT_CHAIN_VERIFIED");
    expect(logged.metadata).toMatchObject({ ok: true });
    expect(JSON.stringify(logged)).not.toContain("@");
  });

  it("verify-export accepts a CSV body and reports the tampered row", async () => {
    const rows = chainOf(3);
    db.adminActionLog.findMany.mockResolvedValue(rows.map((r) => ({ seq: r.seq, hash: r.hash })));
    db.adminActionLog.findUnique.mockResolvedValue({ hash: rows[2].hash });
    const csv = exportCsv(rows).replace('"note 2, with', '"note 2 EDITED, with');
    const res = await VERIFY_EXPORT(new Request("http://localhost/api/admin/audit/verify-export", { method: "POST", body: csv, headers: { "content-type": "text/csv" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.problems[0]).toMatchObject({ reason: "HASH_MISMATCH", seq: 2 });
    expect(db.adminActionLog.create.mock.calls[0][0].data.action).toBe("AUDIT_EXPORT_VERIFIED");
  });

  it("verify-export refuses an empty upload", async () => {
    const res = await VERIFY_EXPORT(new Request("http://localhost/api/admin/audit/verify-export", { method: "POST", body: "  " }));
    expect(res.status).toBe(400);
  });

  it("a checkpoint is HMAC-signed when AUDIT_CHAIN_KEY is set, and audited", async () => {
    process.env.AUDIT_CHAIN_KEY = "secret";
    db.auditChainHead.findUnique.mockResolvedValue({ id: 1, seq: 7, hash: ROW1_HASH });
    db.auditChainCheckpoint.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "cp", ...data }));
    const res = await CHECKPOINT(new Request("http://localhost/api/admin/audit/checkpoint", { method: "POST" }));
    expect(res.status).toBe(201);
    const data = db.auditChainCheckpoint.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ seq: 7, hash: ROW1_HASH, hmac: checkpointHmac("secret", 7, ROW1_HASH) });
    expect(db.adminActionLog.create.mock.calls[0][0].data.action).toBe("AUDIT_CHECKPOINT_CREATED");
  });

  it("a checkpoint without a key is recorded unsigned", async () => {
    db.auditChainHead.findUnique.mockResolvedValue({ id: 1, seq: 7, hash: ROW1_HASH });
    db.auditChainCheckpoint.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "cp", ...data }));
    const res = await CHECKPOINT(new Request("http://localhost/api/admin/audit/checkpoint", { method: "POST" }));
    expect((await res.json()).signed).toBe(false);
  });
});
