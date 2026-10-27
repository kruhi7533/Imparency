-- Operator dead-letter queue (ADM-018 / NEG-012).
--
-- A failed job run, an impact delivery that exhausted its retries, or a donor
-- notification that failed on its channel lands here with ids only (refs), the
-- error, and the attempt count. An admin can replay it once or dismiss it.
-- @@unique(kind, sourceId) makes recording idempotent; the status column is
-- moved OPEN -> REPLAYING by compare-and-swap so a double-clicked replay runs
-- the work once.
--
-- Hand-written and additive. updatedAt is @updatedAt: no DB default.

CREATE TABLE IF NOT EXISTS "DeadLetter" (
  "id"            TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "sourceId"      TEXT NOT NULL,
  "refs"          JSONB,
  "errorMessage"  TEXT,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "status"        TEXT NOT NULL DEFAULT 'OPEN',
  "replayedAt"    TIMESTAMP(3),
  "replayedById"  TEXT,
  "replayResult"  JSONB,
  "dismissedAt"   TIMESTAMP(3),
  "dismissedById" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeadLetter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeadLetter_kind_sourceId_key" ON "DeadLetter"("kind", "sourceId");
CREATE INDEX IF NOT EXISTS "DeadLetter_status_createdAt_idx" ON "DeadLetter"("status", "createdAt");
