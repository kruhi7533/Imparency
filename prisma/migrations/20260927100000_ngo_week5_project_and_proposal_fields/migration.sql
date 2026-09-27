-- Schema changes from 68f85d8 (NGO Week-5 specs) that were merged without a
-- migration: project fields the matching engine scores on (SPEC-8), and
-- proposal versioning on the funder-led Proposal model.
--
-- Written idempotently (IF NOT EXISTS) because the shared dev database already
-- has these columns — they were applied there with `db push`. On a fresh
-- database this is an ordinary additive migration.

-- AlterEnum
ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'CHANGE_REQUESTED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "durationMonths" INTEGER,
ADD COLUMN IF NOT EXISTS "expectedBeneficiaries" INTEGER,
ADD COLUMN IF NOT EXISTS "primaryKPIs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "reportingCadence" TEXT;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "milestones" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
