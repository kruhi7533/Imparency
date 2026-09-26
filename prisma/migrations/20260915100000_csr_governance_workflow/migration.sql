-- CSR/RFP governance workflow: requirement status machine, private document
-- storage metadata, field provenance/version metadata, admin review, matching
-- results, NGO opportunity responses and a requirement audit trail.
--
-- Hand-scoped and purely additive. This database is shared with other branches
-- (e.g. crisis/relief tables that are not in this branch's schema), so a raw
-- `prisma migrate diff` would DROP their objects — none of that is included.
-- The deprecated SponsorRequirement.extractionStatus / rawDocumentUrl columns
-- are kept (backfilled from below) so existing readers keep working.

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'AI_EXTRACTED', 'DONOR_REVIEW', 'PENDING_ADMIN_REVIEW', 'NEEDS_CORRECTION', 'VALIDATED', 'MATCHING', 'SHORTLISTED', 'NGO_RESPONSE', 'SELECTED', 'CONTRACTED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "OpportunityResponseStatus" AS ENUM ('INTERESTED', 'PROPOSAL_SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'REJECTED', 'SELECTED');

-- AlterTable
ALTER TABLE "SponsorRequirement"
ADD COLUMN "fileSize" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "mimeType" TEXT NOT NULL DEFAULT '',
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "selectedAt" TIMESTAMP(3),
ADD COLUMN "selectedNgoId" TEXT,
ADD COLUMN "selectedProjectId" TEXT,
ADD COLUMN "status" "RequirementStatus" NOT NULL DEFAULT 'UPLOADED',
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "validatedAt" TIMESTAMP(3),
ADD COLUMN "versionAuthorId" TEXT,
ADD COLUMN "versionAuthorRole" TEXT,
ADD COLUMN "versionNote" TEXT;

-- AlterTable
ALTER TABLE "RequirementRevision"
ADD COLUMN "changedByRole" TEXT,
ADD COLUMN "status" TEXT;

-- AlterTable
ALTER TABLE "GapReport"
ADD COLUMN "algorithmVersion" TEXT,
ADD COLUMN "candidateCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "eligibleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reviewNote" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "triggeredById" TEXT;

-- CreateTable
CREATE TABLE "RequirementAuditLog" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "detail" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementMatch" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "gapReportId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "rank" INTEGER,
    "score" INTEGER,
    "coverage" INTEGER NOT NULL,
    "hardEligibility" JSONB NOT NULL,
    "dimensionScores" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityResponse" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "respondedById" TEXT NOT NULL,
    "status" "OpportunityResponseStatus" NOT NULL DEFAULT 'INTERESTED',
    "proposedBudget" DECIMAL(14,2),
    "proposedDurationMonths" INTEGER,
    "implementationPlan" TEXT,
    "milestones" JSONB,
    "expectedOutcomes" TEXT,
    "complianceNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "OpportunityResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsorRequirement_status_idx" ON "SponsorRequirement"("status");
CREATE INDEX "RequirementAuditLog_requirementId_idx" ON "RequirementAuditLog"("requirementId");
CREATE INDEX "RequirementAuditLog_actorId_idx" ON "RequirementAuditLog"("actorId");
CREATE INDEX "RequirementMatch_requirementId_idx" ON "RequirementMatch"("requirementId");
CREATE INDEX "RequirementMatch_ngoId_idx" ON "RequirementMatch"("ngoId");
CREATE UNIQUE INDEX "RequirementMatch_gapReportId_projectId_key" ON "RequirementMatch"("gapReportId", "projectId");
CREATE INDEX "OpportunityResponse_ngoId_idx" ON "OpportunityResponse"("ngoId");
CREATE UNIQUE INDEX "OpportunityResponse_requirementId_ngoId_key" ON "OpportunityResponse"("requirementId", "ngoId");

-- AddForeignKey
ALTER TABLE "RequirementAuditLog" ADD CONSTRAINT "RequirementAuditLog_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "SponsorRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementMatch" ADD CONSTRAINT "RequirementMatch_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "SponsorRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementMatch" ADD CONSTRAINT "RequirementMatch_gapReportId_fkey" FOREIGN KEY ("gapReportId") REFERENCES "GapReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementMatch" ADD CONSTRAINT "RequirementMatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementMatch" ADD CONSTRAINT "RequirementMatch_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityResponse" ADD CONSTRAINT "OpportunityResponse_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "SponsorRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityResponse" ADD CONSTRAINT "OpportunityResponse_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityResponse" ADD CONSTRAINT "OpportunityResponse_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill existing requirements ─────────────────────────────────────────
-- Lifecycle status from the deprecated free-text column. Rows the donor had
-- "Approved & Saved" were never checked by an admin, so they enter the admin
-- queue rather than becoming VALIDATED. Rows stuck mid-extraction (no process
-- is running during a migration) become FAILED so they can be retried.
UPDATE "SponsorRequirement" SET "status" = (CASE "extractionStatus"
    WHEN 'PENDING_REVIEW' THEN 'DONOR_REVIEW'
    WHEN 'VALIDATED' THEN 'PENDING_ADMIN_REVIEW'
    ELSE 'FAILED'
  END)::"RequirementStatus";

UPDATE "SponsorRequirement" SET "submittedAt" = "updatedAt" WHERE "extractionStatus" = 'VALIDATED';

-- Private storage key from the old public URL ("/uploads/requirements/x.pdf" →
-- "requirements/x.pdf"). The files themselves are moved out of public/ separately.
UPDATE "SponsorRequirement" SET "storageKey" = substring("rawDocumentUrl" from 10)
  WHERE "rawDocumentUrl" LIKE '/uploads/requirements/%';

UPDATE "SponsorRequirement" SET "mimeType" = (CASE lower(substring("rawDocumentUrl" from '\.([A-Za-z0-9]+)$'))
    WHEN 'pdf' THEN 'application/pdf'
    WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'png' THEN 'image/png'
    WHEN 'jpg' THEN 'image/jpeg'
    WHEN 'jpeg' THEN 'image/jpeg'
    WHEN 'webp' THEN 'image/webp'
    ELSE ''
  END)
  WHERE "mimeType" = '';

UPDATE "SponsorRequirement" SET "versionNote" = 'AI extraction', "versionAuthorRole" = 'SYSTEM'
  WHERE "versionNote" IS NULL;
