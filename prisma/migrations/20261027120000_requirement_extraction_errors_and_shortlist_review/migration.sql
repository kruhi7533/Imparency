-- Workstream C (D3): CSR requirement extraction errors/flags and admin shortlist review.
-- Additive only.

-- The last extraction failure as { code, message, retryable, at }, so a FAILED
-- requirement shows WHY it failed after a reload (never an empty 500).
ALTER TABLE "SponsorRequirement" ADD COLUMN IF NOT EXISTS "extractionError" JSONB;
-- Deterministic findings over the document text: budget conflicts and suspected
-- prompt injection. [{ id, code, severity, message, evidence, blocking, confirmedAt?, confirmedById?, note? }]
ALTER TABLE "SponsorRequirement" ADD COLUMN IF NOT EXISTS "extractionFlags" JSONB;

-- Admin decision on each shortlisted candidate before any NGO is invited.
ALTER TABLE "RequirementMatch" ADD COLUMN IF NOT EXISTS "adminDecision" TEXT;
ALTER TABLE "RequirementMatch" ADD COLUMN IF NOT EXISTS "adminRank" INTEGER;
ALTER TABLE "RequirementMatch" ADD COLUMN IF NOT EXISTS "adminNote" TEXT;
ALTER TABLE "RequirementMatch" ADD COLUMN IF NOT EXISTS "adminDecidedAt" TIMESTAMP(3);
ALTER TABLE "RequirementMatch" ADD COLUMN IF NOT EXISTS "adminDecidedById" TEXT;
