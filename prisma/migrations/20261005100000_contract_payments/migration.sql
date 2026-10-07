-- Week 6: NGO acceptance of a funded contract, and donor-recorded contract
-- payments with two-sided reconciliation.
--
-- The CSR contract track had no money record at all: "disbursing" a milestone
-- only flipped a status. ContractPayment records what the donor says they paid
-- (SANDBOX or MANUAL — the platform still moves no money), and the NGO
-- confirming receipt is what makes it RECONCILED.
--
-- Additive and re-runnable, like 20260930200000_allocation_payment. Written by
-- hand because `migrate dev` cannot run against the shared dev database.

DO $$ BEGIN
    CREATE TYPE "ContractPaymentMode" AS ENUM ('SANDBOX', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ContractPaymentStatus" AS ENUM ('PENDING_CONFIRMATION', 'RECONCILED', 'DISPUTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "FinanceExceptionType" ADD VALUE IF NOT EXISTS 'CONTRACT_PAYMENT_DISPUTED';

ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "ngoAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "ngoAcceptedById" TEXT;

CREATE TABLE IF NOT EXISTS "ContractPayment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractMilestoneId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "mode" "ContractPaymentMode" NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ContractPaymentStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "disputeNote" TEXT,

    CONSTRAINT "ContractPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContractPayment_idempotencyKey_key" ON "ContractPayment"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ContractPayment_contractId_idx" ON "ContractPayment"("contractId");
CREATE INDEX IF NOT EXISTS "ContractPayment_contractMilestoneId_idx" ON "ContractPayment"("contractMilestoneId");
CREATE INDEX IF NOT EXISTS "ContractPayment_status_idx" ON "ContractPayment"("status");

DO $$ BEGIN
    ALTER TABLE "ContractPayment"
      ADD CONSTRAINT "ContractPayment_contractId_fkey"
      FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ContractPayment"
      ADD CONSTRAINT "ContractPayment_contractMilestoneId_fkey"
      FOREIGN KEY ("contractMilestoneId") REFERENCES "ContractMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
