-- Tamper-evident admin audit trail (ADM-017 / NEG-013).
--
-- Every AdminActionLog row gets a position in a hash chain:
--   seq       1, 2, 3, ... with no gaps
--   prevHash  the hash of row seq-1 (64 zeros for seq 1, the genesis)
--   hash      sha256( canonical(row incl. seq + prevHash) ), hex
--
-- The chain is computed INSIDE the database by a BEFORE INSERT trigger, so it
-- covers every writer (logAdminAction, a raw SQL insert, a script) and cannot
-- be skipped or forged by the application: whatever the client sends for
-- seq/prevHash/hash is overwritten. Appends are serialised by a row lock on the
-- single-row AuditChainHead (SELECT ... FOR UPDATE), held until the inserting
-- transaction commits, so two concurrent inserts can never claim the same seq
-- or fork the chain; a rolled-back insert rolls back the head too (no gap).
--
-- The canonical form is jsonb_build_object(...)::text: jsonb renders keys in a
-- fixed order (by length, then bytewise) with fixed ": " / ", " separators, so
-- it is deterministic. lib/audit-chain.ts reproduces it byte-for-byte in JS for
-- offline verification of an exported CSV.
--
-- Rows are append-only: a trigger rejects UPDATE, DELETE and TRUNCATE. No code
-- in the app updates or deletes AdminActionLog (checked before adding this).
-- Consequence worth knowing: a User referenced by an audit row can no longer be
-- hard-deleted (the FK's ON DELETE SET NULL is an UPDATE). That is intended.
--
-- Threat model and what this does NOT cover: docs/AUDIT-INTEGRITY.md.
--
-- Hand-written and additive. Defaults match schema.prisma exactly.

ALTER TABLE "AdminActionLog" ADD COLUMN IF NOT EXISTS "seq" INTEGER;
ALTER TABLE "AdminActionLog" ADD COLUMN IF NOT EXISTS "prevHash" TEXT;
ALTER TABLE "AdminActionLog" ADD COLUMN IF NOT EXISTS "hash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "AdminActionLog_seq_key" ON "AdminActionLog"("seq");

CREATE TABLE IF NOT EXISTS "AuditChainHead" (
  "id"        INTEGER NOT NULL,
  "seq"       INTEGER NOT NULL DEFAULT 0,
  "hash"      TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditChainCheckpoint" (
  "id"             TEXT NOT NULL,
  "seq"            INTEGER NOT NULL,
  "hash"           TEXT NOT NULL,
  "hmac"           TEXT,
  "keyFingerprint" TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditChainCheckpoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditChainCheckpoint_seq_idx" ON "AuditChainCheckpoint"("seq");

-- The canonical serialisation. Keep in lockstep with canonicalAuditText() in
-- lib/audit-chain.ts; tests/audit-chain.test.ts pins the JS side.
CREATE OR REPLACE FUNCTION audit_chain_canonical(r "AdminActionLog") RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'v', 1,
    'seq', r."seq",
    'prevHash', r."prevHash",
    'id', r."id",
    'adminId', r."adminId",
    'action', r."action",
    'entityType', r."entityType",
    'entityId', r."entityId",
    'oldValue', r."oldValue",
    'newValue', r."newValue",
    'note', r."note",
    'metadata', r."metadata",
    'ipAddress', r."ipAddress",
    'userAgent', r."userAgent",
    'schemaVersion', r."schemaVersion",
    'createdAt', to_char(r."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text
$$;

CREATE OR REPLACE FUNCTION audit_chain_hash(r "AdminActionLog") RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(audit_chain_canonical(r), 'UTF8')), 'hex')
$$;

-- Genesis + backfill of rows written before the chain existed, oldest first.
-- Runs before the immutability trigger exists, and only seals rows with no seq.
DO $$
DECLARE
  r RECORD;
  prev TEXT := repeat('0', 64);
  n INTEGER := 0;
  h TEXT;
BEGIN
  SELECT COALESCE(MAX("seq"), 0) INTO n FROM "AdminActionLog";
  IF n > 0 THEN
    SELECT "hash" INTO prev FROM "AdminActionLog" WHERE "seq" = n;
  END IF;
  FOR r IN SELECT "id" FROM "AdminActionLog" WHERE "seq" IS NULL ORDER BY "createdAt", "id" LOOP
    n := n + 1;
    UPDATE "AdminActionLog"
       SET "seq" = n,
           "prevHash" = prev,
           "createdAt" = date_trunc('milliseconds', "createdAt")
     WHERE "id" = r."id";
    UPDATE "AdminActionLog" a SET "hash" = audit_chain_hash(a) WHERE a."id" = r."id" RETURNING a."hash" INTO h;
    prev := h;
  END LOOP;
  INSERT INTO "AuditChainHead" ("id", "seq", "hash", "updatedAt") VALUES (1, n, prev, CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION audit_chain_append() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  h_seq INTEGER;
  h_hash TEXT;
BEGIN
  SELECT "seq", "hash" INTO h_seq, h_hash FROM "AuditChainHead" WHERE "id" = 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO "AuditChainHead" ("id", "seq", "hash") VALUES (1, 0, repeat('0', 64)) ON CONFLICT ("id") DO NOTHING;
    SELECT "seq", "hash" INTO h_seq, h_hash FROM "AuditChainHead" WHERE "id" = 1 FOR UPDATE;
  END IF;
  NEW."createdAt" := date_trunc('milliseconds', COALESCE(NEW."createdAt", CURRENT_TIMESTAMP));
  NEW."seq" := h_seq + 1;
  NEW."prevHash" := h_hash;
  NEW."hash" := audit_chain_hash(NEW);
  UPDATE "AuditChainHead" SET "seq" = NEW."seq", "hash" = NEW."hash", "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = 1;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION audit_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table "%" is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END $$;

DROP TRIGGER IF EXISTS "AdminActionLog_chain_append" ON "AdminActionLog";
CREATE TRIGGER "AdminActionLog_chain_append" BEFORE INSERT ON "AdminActionLog"
  FOR EACH ROW EXECUTE FUNCTION audit_chain_append();

DROP TRIGGER IF EXISTS "AdminActionLog_append_only" ON "AdminActionLog";
CREATE TRIGGER "AdminActionLog_append_only" BEFORE UPDATE OR DELETE ON "AdminActionLog"
  FOR EACH ROW EXECUTE FUNCTION audit_reject_mutation();

DROP TRIGGER IF EXISTS "AdminActionLog_no_truncate" ON "AdminActionLog";
CREATE TRIGGER "AdminActionLog_no_truncate" BEFORE TRUNCATE ON "AdminActionLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_mutation();

DROP TRIGGER IF EXISTS "AuditChainCheckpoint_append_only" ON "AuditChainCheckpoint";
CREATE TRIGGER "AuditChainCheckpoint_append_only" BEFORE UPDATE OR DELETE ON "AuditChainCheckpoint"
  FOR EACH ROW EXECUTE FUNCTION audit_reject_mutation();
