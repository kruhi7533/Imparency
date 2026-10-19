-- Beneficiary cohort: who a project serves (with expectedBeneficiaries, how many).
-- Additive; idempotent so it can also be applied by hand to the shared dev DB.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "beneficiaryGroup" TEXT;
