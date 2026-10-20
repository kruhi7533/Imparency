-- Approved field evidence attached to a milestone proof by reference (ids only).
ALTER TABLE "MilestoneProof" ADD COLUMN IF NOT EXISTS "fieldEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
