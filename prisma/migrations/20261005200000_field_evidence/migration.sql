-- Week 7: field tasks, offline-captured evidence (photo + GPS + note), and
-- beneficiary feedback with per-purpose consent.
--
-- Additive and re-runnable. Written by hand because `migrate dev` cannot run
-- against the shared dev database.

DO $$ BEGIN CREATE TYPE "FieldTaskStatus" AS ENUM ('OPEN', 'SUBMITTED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "FieldEvidenceStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'RESUBMIT_REQUESTED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ConsentMethod" AS ENUM ('VERBAL', 'WRITTEN', 'THUMBPRINT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "FieldTask" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "FieldTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FieldTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FieldTask_ngoId_status_idx" ON "FieldTask"("ngoId", "status");
CREATE INDEX IF NOT EXISTS "FieldTask_assignedToId_status_idx" ON "FieldTask"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "FieldTask_projectId_idx" ON "FieldTask"("projectId");

CREATE TABLE IF NOT EXISTS "FieldEvidence" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "capturedById" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "photoKey" TEXT NOT NULL,
    "photoMime" TEXT NOT NULL,
    "photoSha256" TEXT NOT NULL,
    "duplicateOfId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyM" DOUBLE PRECISION,
    "locationStatus" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "note" TEXT,
    "containsPeople" BOOLEAN NOT NULL DEFAULT true,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "FieldEvidenceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    CONSTRAINT "FieldEvidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FieldEvidence_clientId_key" ON "FieldEvidence"("clientId");
CREATE INDEX IF NOT EXISTS "FieldEvidence_ngoId_status_idx" ON "FieldEvidence"("ngoId", "status");
CREATE INDEX IF NOT EXISTS "FieldEvidence_projectId_status_idx" ON "FieldEvidence"("projectId", "status");
CREATE INDEX IF NOT EXISTS "FieldEvidence_photoSha256_idx" ON "FieldEvidence"("photoSha256");

CREATE TABLE IF NOT EXISTS "BeneficiaryFeedback" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "evidenceId" TEXT,
    "clientId" TEXT NOT NULL,
    "beneficiaryRef" TEXT,
    "consentToRecord" BOOLEAN NOT NULL,
    "consentToSharePhoto" BOOLEAN NOT NULL DEFAULT false,
    "consentMethod" "ConsentMethod" NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT '1.0',
    "withdrawnAt" TIMESTAMP(3),
    "rating" INTEGER,
    "feedbackText" TEXT,
    "capturedById" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BeneficiaryFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BeneficiaryFeedback_evidenceId_key" ON "BeneficiaryFeedback"("evidenceId");
CREATE UNIQUE INDEX IF NOT EXISTS "BeneficiaryFeedback_clientId_key" ON "BeneficiaryFeedback"("clientId");
CREATE INDEX IF NOT EXISTS "BeneficiaryFeedback_ngoId_idx" ON "BeneficiaryFeedback"("ngoId");
CREATE INDEX IF NOT EXISTS "BeneficiaryFeedback_projectId_idx" ON "BeneficiaryFeedback"("projectId");

DO $$ BEGIN ALTER TABLE "FieldTask" ADD CONSTRAINT "FieldTask_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "FieldTask" ADD CONSTRAINT "FieldTask_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "FieldEvidence" ADD CONSTRAINT "FieldEvidence_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "FieldTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BeneficiaryFeedback" ADD CONSTRAINT "BeneficiaryFeedback_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "FieldEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
