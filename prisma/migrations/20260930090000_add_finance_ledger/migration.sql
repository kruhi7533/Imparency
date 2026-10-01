-- Week 6 "funded project exists": the finance ledger, its exception queue, and
-- a record of each reconciliation run.
--
-- Additive and re-runnable (IF NOT EXISTS / DO blocks for the enums) so it can
-- be applied by hand to the shared Neon dev database, which carries tables this
-- schema does not know about — see CLAUDE.md on why `migrate dev` is not used.

DO $$ BEGIN
    CREATE TYPE "LedgerEntryType" AS ENUM ('DONATION_CAPTURED', 'DONATION_REFUNDED', 'ALLOCATION_COMMITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "FinanceExceptionType" AS ENUM ('UNMATCHED_PAYMENT', 'MISSING_LEDGER_ENTRY', 'PROJECT_TOTAL_MISMATCH', 'DONOR_TOTAL_MISMATCH', 'STALE_PENDING_DONATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "FinanceExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "LedgerEntry" (
    "id" TEXT NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "projectId" TEXT,
    "ngoId" TEXT,
    "donorId" TEXT,
    "donationId" TEXT,
    "externalRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- Load-bearing: this is what makes a replayed money event a no-op rather than
-- a second row. It sits inside the webhook's transaction.
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "LedgerEntry_projectId_entryType_idx" ON "LedgerEntry"("projectId", "entryType");
CREATE INDEX IF NOT EXISTS "LedgerEntry_donorId_idx" ON "LedgerEntry"("donorId");
CREATE INDEX IF NOT EXISTS "LedgerEntry_donationId_idx" ON "LedgerEntry"("donationId");
CREATE INDEX IF NOT EXISTS "LedgerEntry_occurredAt_idx" ON "LedgerEntry"("occurredAt");

CREATE TABLE IF NOT EXISTS "FinanceException" (
    "id" TEXT NOT NULL,
    "type" "FinanceExceptionType" NOT NULL,
    "status" "FinanceExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "expectedAmount" DECIMAL(12,2),
    "observedAmount" DECIMAL(12,2),
    "detail" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "FinanceException_pkey" PRIMARY KEY ("id")
);

-- Re-running reconciliation must bump an existing finding, not duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS "FinanceException_dedupeKey_key" ON "FinanceException"("dedupeKey");
CREATE INDEX IF NOT EXISTS "FinanceException_status_type_idx" ON "FinanceException"("status", "type");
CREATE INDEX IF NOT EXISTS "FinanceException_entityType_entityId_idx" ON "FinanceException"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "FinanceException_lastSeenAt_idx" ON "FinanceException"("lastSeenAt");

CREATE TABLE IF NOT EXISTS "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "triggeredById" TEXT,
    "projectsChecked" INTEGER NOT NULL DEFAULT 0,
    "donationsChecked" INTEGER NOT NULL DEFAULT 0,
    "donorsChecked" INTEGER NOT NULL DEFAULT 0,
    "opened" INTEGER NOT NULL DEFAULT 0,
    "recurred" INTEGER NOT NULL DEFAULT 0,
    "autoResolved" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ReconciliationRun_startedAt_idx" ON "ReconciliationRun"("startedAt");
