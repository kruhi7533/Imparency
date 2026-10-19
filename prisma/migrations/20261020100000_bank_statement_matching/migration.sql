-- Bank-statement matching for contract payments: an NGO uploads its statement,
-- and lines carrying a pending payment's reference + amount reconcile it.
-- Purely additive; idempotent so it can also be applied by hand to the shared
-- dev database.

DO $$ BEGIN
  CREATE TYPE "BankStatementLineStatus" AS ENUM ('MATCHED', 'AMOUNT_MISMATCH', 'AMBIGUOUS', 'UNMATCHED', 'DEBIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "FinanceExceptionType" ADD VALUE IF NOT EXISTS 'BANK_LINE_AMOUNT_MISMATCH';

ALTER TABLE "ContractPayment" ADD COLUMN IF NOT EXISTS "reconciledVia" TEXT;

CREATE TABLE IF NOT EXISTS "BankStatementImport" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "lineCount" INTEGER NOT NULL,
    "newLineCount" INTEGER NOT NULL,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BankStatementLine" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "direction" TEXT NOT NULL,
    "lineHash" TEXT NOT NULL,
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "note" TEXT,
    "matchedPaymentId" TEXT,
    "candidatePaymentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankStatementImport_ngoId_createdAt_idx" ON "BankStatementImport"("ngoId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "BankStatementLine_matchedPaymentId_key" ON "BankStatementLine"("matchedPaymentId");
CREATE INDEX IF NOT EXISTS "BankStatementLine_importId_idx" ON "BankStatementLine"("importId");
CREATE INDEX IF NOT EXISTS "BankStatementLine_ngoId_status_idx" ON "BankStatementLine"("ngoId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "BankStatementLine_ngoId_lineHash_key" ON "BankStatementLine"("ngoId", "lineHash");

DO $$ BEGIN
  ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_matchedPaymentId_fkey" FOREIGN KEY ("matchedPaymentId") REFERENCES "ContractPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
