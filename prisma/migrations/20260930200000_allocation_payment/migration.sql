-- Did the committed money actually arrive?
--
-- An allocation on its own is a promise. Nothing could say whether a funder
-- ever transferred what was committed, so an organisation could be planning
-- work against money that never came — and the platform would be showing the
-- commitment as if it had. That is the trust failure this closes.
--
-- The platform still does not move this money. AllocationPayment records an
-- ATTESTATION by a named admin, with a reference a statement can be checked
-- against. UNCONFIRMED_ALLOCATION is the finding raised when a commitment goes
-- unconfirmed past any plausible transfer window.
--
-- Additive and re-runnable.

ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'ALLOCATION_FUNDED';
ALTER TYPE "FinanceExceptionType" ADD VALUE IF NOT EXISTS 'UNCONFIRMED_ALLOCATION';

CREATE TABLE IF NOT EXISTS "AllocationPayment" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AllocationPayment_allocationId_idx" ON "AllocationPayment"("allocationId");
CREATE INDEX IF NOT EXISTS "AllocationPayment_paidAt_idx" ON "AllocationPayment"("paidAt");

DO $$ BEGIN
    ALTER TABLE "AllocationPayment"
      ADD CONSTRAINT "AllocationPayment_allocationId_fkey"
      FOREIGN KEY ("allocationId") REFERENCES "Allocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
