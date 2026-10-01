-- Allocation: money committed to an approved proposal.
--
-- Closes the Week 6 theme. An APPROVED Proposal was a dead end — the platform
-- agreed with a plan and nothing recorded that anything had been set aside for
-- it, so an opportunity's remaining budget was a number nobody could produce.
--
-- A commitment, not a payment. Disbursement is a separate module and stays
-- last.
--
-- Additive and re-runnable, so it can be applied by hand to the shared Neon
-- dev database (see CLAUDE.md on why migrate dev is not used here).

DO $$ BEGIN
    CREATE TYPE "AllocationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Allocation" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PENDING',
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- One commitment per approved plan. A second one is not a correction, it is
-- double-funding; this constraint is what makes it impossible rather than
-- merely discouraged.
CREATE UNIQUE INDEX IF NOT EXISTS "Allocation_proposalId_key" ON "Allocation"("proposalId");
CREATE INDEX IF NOT EXISTS "Allocation_opportunityId_status_idx" ON "Allocation"("opportunityId", "status");
CREATE INDEX IF NOT EXISTS "Allocation_ngoId_idx" ON "Allocation"("ngoId");
CREATE INDEX IF NOT EXISTS "Allocation_status_idx" ON "Allocation"("status");

DO $$ BEGIN
    ALTER TABLE "Allocation"
      ADD CONSTRAINT "Allocation_proposalId_fkey"
      FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
