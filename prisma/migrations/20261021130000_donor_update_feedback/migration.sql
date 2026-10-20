-- Donor feedback on project updates. Additive and idempotent.
DO $$ BEGIN
  CREATE TYPE "DonorFeedbackSignal" AS ENUM ('HELPFUL', 'NEED_MORE_DETAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DonorUpdateFeedback" (
  "id" TEXT NOT NULL,
  "donorId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL DEFAULT '',
  "signal" "DonorFeedbackSignal" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DonorUpdateFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DonorUpdateFeedback_donorId_projectId_eventKey_key" ON "DonorUpdateFeedback"("donorId", "projectId", "eventKey");
CREATE INDEX IF NOT EXISTS "DonorUpdateFeedback_projectId_createdAt_idx" ON "DonorUpdateFeedback"("projectId", "createdAt");
