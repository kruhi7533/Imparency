-- Align SponsorRequirement defaults with prisma/schema.prisma.
-- These columns predate migrations in some environments, so explicit ALTERs are required.
ALTER TABLE "SponsorRequirement"
  ALTER COLUMN "rawDocumentUrl" SET DEFAULT '',
  ALTER COLUMN "fileName" SET DEFAULT '',
  ALTER COLUMN "fileHash" SET DEFAULT '',
  ALTER COLUMN "rawText" SET DEFAULT '',
  ALTER COLUMN "extractedFields" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "confidenceScores" SET DEFAULT '{}'::jsonb,
  ALTER COLUMN "extractionStatus" SET DEFAULT 'UPLOADED';
