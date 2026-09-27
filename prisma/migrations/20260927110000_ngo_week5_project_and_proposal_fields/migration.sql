-- The NGO Week-5 work (SPEC-3, SPEC-4, SPEC-8) added these to schema.prisma and
-- reached the dev database through `prisma db push`, so no migration existed and
-- the columns lived on exactly one database. Written after the fact.
--
-- Guarded throughout, because that same database already has them: this must be
-- a no-op where the push already ran, and the real thing everywhere else. Same
-- shape as 20260905120000 and 20260915100000, for the same reason.

-- AlterEnum: ProposalStatus += CHANGE_REQUESTED
-- ADD VALUE is transactional from PostgreSQL 12 on, and nothing below uses the
-- new value, so it is safe inside the migration's transaction.
DO $$ BEGIN
    ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'CHANGE_REQUESTED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable: Project gains the dimensions matching scores on.
-- Before these, geography, duration, beneficiaries and reporting cadence all
-- came back "insufficient data" and the shortlist scored on four of nine
-- criteria — see docs/WEEK5-GAPS.md, X-3.
ALTER TABLE "Project"
    ADD COLUMN IF NOT EXISTS "durationMonths" INTEGER,
    ADD COLUMN IF NOT EXISTS "expectedBeneficiaries" INTEGER,
    ADD COLUMN IF NOT EXISTS "primaryKPIs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS "reportingCadence" TEXT;

-- AlterTable: Proposal gains versioning and structured milestones.
-- Defaults are required, not cosmetic: existing rows are version 1 with no
-- history, which is true of them.
ALTER TABLE "Proposal"
    ADD COLUMN IF NOT EXISTS "history" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS "milestones" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
