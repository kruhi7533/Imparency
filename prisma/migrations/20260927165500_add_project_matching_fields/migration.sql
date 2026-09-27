-- AlterEnum
ALTER TYPE "ProposalStatus" ADD VALUE 'CHANGE_REQUESTED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "durationMonths" INTEGER,
ADD COLUMN "expectedBeneficiaries" INTEGER,
ADD COLUMN "primaryKPIs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "reportingCadence" TEXT;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN "milestones" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]';
