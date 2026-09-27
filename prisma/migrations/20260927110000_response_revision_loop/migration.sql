-- Week-5 donor <-> NGO revision loop on the CSR requirement track
-- (docs/WEEK5-SPECS.md SPEC-3, SPEC-4, SPEC-6). Purely additive; idempotent so
-- it can also be applied by hand to the shared dev database.

-- SPEC-3: the donor can send a proposal back with a note.
ALTER TYPE "OpportunityResponseStatus" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';

ALTER TABLE "OpportunityResponse" ADD COLUMN IF NOT EXISTS "changeRequestNote" TEXT,
ADD COLUMN IF NOT EXISTS "changeRequestedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "changeRequestedById" TEXT,
ADD COLUMN IF NOT EXISTS "revisionRounds" INTEGER NOT NULL DEFAULT 0,
-- SPEC-4: live version number; superseded versions live in the table below.
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- SPEC-6: which proposal version the donor approved.
ALTER TABLE "SponsorRequirement" ADD COLUMN IF NOT EXISTS "selectedResponseVersion" INTEGER;

-- SPEC-4: V1 survives V2.
CREATE TABLE IF NOT EXISTS "OpportunityResponseRevision" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "proposedBudget" DECIMAL(14,2),
    "proposedDurationMonths" INTEGER,
    "implementationPlan" TEXT,
    "milestones" JSONB,
    "expectedOutcomes" TEXT,
    "complianceNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "supersededBecause" TEXT,
    "changedById" TEXT,
    "changedByRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityResponseRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpportunityResponseRevision_responseId_idx" ON "OpportunityResponseRevision"("responseId");

CREATE UNIQUE INDEX IF NOT EXISTS "OpportunityResponseRevision_responseId_version_key" ON "OpportunityResponseRevision"("responseId", "version");

DO $$ BEGIN
  ALTER TABLE "OpportunityResponseRevision" ADD CONSTRAINT "OpportunityResponseRevision_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "OpportunityResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
