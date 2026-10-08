-- Week 7 completion: beneficiary consent withdrawal + donor update opt-out.
--
-- Additive and re-runnable (IF NOT EXISTS) so it can be applied by hand to the
-- shared Neon dev database with `npx prisma migrate deploy` — see CLAUDE.md on
-- why `migrate dev` is not used here. No backfill needed: NULL withdrawnById
-- means "never withdrawn", and FALSE opt-out keeps today's behaviour.

ALTER TABLE "BeneficiaryFeedback"
    ADD COLUMN IF NOT EXISTS "withdrawnById" TEXT;

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "projectUpdatesOptOut" BOOLEAN NOT NULL DEFAULT false;

-- Duplicate verdict on field evidence, computed across field captures AND
-- milestone proofs (lib/evidence-duplicates.ts). NULL on older rows: "not
-- classified", which the review queue renders as nothing rather than as clean.
ALTER TABLE "FieldEvidence"
    ADD COLUMN IF NOT EXISTS "duplicateVerdict" TEXT;
