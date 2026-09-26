-- Reconciles databases that were created with `prisma db push` before this repo
-- adopted Prisma Migrate. On those databases "SponsorRequirement" exists in an
-- older shape (donorId/title/extractedData) and "AgentExecution" was never
-- created, so 20260810150500_add_sponsor_requirement cannot be replayed and is
-- baselined as applied instead. Everything here is additive and idempotent.

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentExecution" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "status" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentExecution_agentName_idx" ON "AgentExecution"("agentName");
CREATE INDEX IF NOT EXISTS "AgentExecution_entityId_idx" ON "AgentExecution"("entityId");

-- AlterTable
ALTER TABLE "SponsorRequirement"
    ADD COLUMN IF NOT EXISTS "sponsorId" TEXT,
    ADD COLUMN IF NOT EXISTS "rawDocumentUrl" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "fileName" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "fileHash" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "rawText" TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS "extractedFields" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "confidenceScores" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "extractionStatus" TEXT NOT NULL DEFAULT 'UPLOADED',
    ADD COLUMN IF NOT EXISTS "extractedByAgent" TEXT NOT NULL DEFAULT 'RequirementsAnalystAgent',
    ADD COLUMN IF NOT EXISTS "modelVersion" TEXT NOT NULL DEFAULT 'gpt-4o';

-- Carry legacy rows over to the current column names, then stop requiring the
-- legacy columns Prisma no longer writes.
UPDATE "SponsorRequirement" SET "sponsorId" = "donorId"
    WHERE "sponsorId" IS NULL AND "donorId" IS NOT NULL;

DO $$ BEGIN
    ALTER TABLE "SponsorRequirement" ALTER COLUMN "title" DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "SponsorRequirement" ALTER COLUMN "extractedData" DROP NOT NULL;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SponsorRequirement_sponsorId_idx" ON "SponsorRequirement"("sponsorId");
CREATE INDEX IF NOT EXISTS "SponsorRequirement_fileHash_idx" ON "SponsorRequirement"("fileHash");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SponsorRequirement" ADD CONSTRAINT "SponsorRequirement_sponsorId_fkey"
        FOREIGN KEY ("sponsorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
