-- Duplicate of 20260927110000_ngo_week5_project_and_proposal_fields, which adds
-- the same Project columns, the same Proposal columns and the same enum value.
-- Both reached main from different branches: the NGO Week-5 work was applied to
-- the dev database with `prisma db push`, so two people wrote the missing
-- migration independently and neither saw the other.
--
-- Kept rather than deleted because it is already on main and may have been
-- applied somewhere; made idempotent so `migrate deploy` is a clean no-op
-- wherever 20260927110000 ran first. Unguarded, this failed with
-- "column durationMonths already exists" and took the whole deploy with it.
--
-- Same guarded shape as 20260915100000 and 20260927110000, for the same reason.

-- AlterEnum: ProposalStatus += CHANGE_REQUESTED
DO $$ BEGIN
    ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'CHANGE_REQUESTED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "durationMonths" INTEGER,
    ADD COLUMN IF NOT EXISTS "expectedBeneficiaries" INTEGER,
    ADD COLUMN IF NOT EXISTS "primaryKPIs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS "reportingCadence" TEXT;

-- AlterTable
ALTER TABLE "Proposal"
    ADD COLUMN IF NOT EXISTS "milestones" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS "history" JSONB NOT NULL DEFAULT '[]';
