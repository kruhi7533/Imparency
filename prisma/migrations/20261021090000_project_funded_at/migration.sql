-- "Project becomes FUNDED": the moment every committed contract rupee was first
-- reconciled. Additive; idempotent so it can also be applied by hand to the
-- shared dev database.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "fundedAt" TIMESTAMP(3);
