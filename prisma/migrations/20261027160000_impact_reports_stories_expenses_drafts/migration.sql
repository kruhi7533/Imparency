-- Workstream G: stored contract impact reports, renewal requests, consent-
-- filtered impact stories, contract expenses, NGO registration drafts.
-- Additive only.

CREATE TYPE "StoryConsentScope" AS ENUM ('NONE', 'DONOR_ONLY', 'PUBLIC');
CREATE TYPE "ContractReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'PUBLISHED');
CREATE TYPE "RenewalRequestKind" AS ENUM ('RENEWAL', 'NEXT_OPPORTUNITY');
CREATE TYPE "RenewalRequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED');
CREATE TYPE "ImpactStoryVariant" AS ENUM ('PUBLIC', 'DONOR');
CREATE TYPE "ImpactStoryStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'REJECTED', 'NEEDS_REGENERATION');
CREATE TYPE "ImpactStoryGenerator" AS ENUM ('AI_MODEL', 'TEMPLATE');
CREATE TYPE "ExpenseCategory" AS ENUM ('PERSONNEL', 'MATERIALS', 'TRAVEL', 'EQUIPMENT', 'TRAINING', 'ADMINISTRATIVE', 'OTHER');
CREATE TYPE "RegistrationDraftStatus" AS ENUM ('DRAFT', 'SUBMITTED');

ALTER TABLE "BeneficiaryFeedback" ADD COLUMN "storyConsent" "StoryConsentScope" NOT NULL DEFAULT 'NONE';
ALTER TABLE "BeneficiaryFeedback" ADD COLUMN "storyConsentAt" TIMESTAMP(3);

CREATE TABLE "ContractImpactReport" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "ContractReportStatus" NOT NULL DEFAULT 'DRAFT',
    "claimIds" TEXT[],
    "createdById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContractImpactReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContractImpactReport_contractId_status_idx" ON "ContractImpactReport"("contractId", "status");
CREATE INDEX "ContractImpactReport_ngoId_status_idx" ON "ContractImpactReport"("ngoId", "status");
CREATE INDEX "ContractImpactReport_donorId_status_idx" ON "ContractImpactReport"("donorId", "status");
CREATE INDEX "ContractImpactReport_status_submittedAt_idx" ON "ContractImpactReport"("status", "submittedAt");

CREATE TABLE "RenewalRequest" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "kind" "RenewalRequestKind" NOT NULL,
    "message" TEXT,
    "proposedAmount" DECIMAL(12,2),
    "status" "RenewalRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedById" TEXT NOT NULL,
    "ngoResponse" TEXT,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RenewalRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RenewalRequest_reportId_kind_key" ON "RenewalRequest"("reportId", "kind");
CREATE INDEX "RenewalRequest_ngoId_status_idx" ON "RenewalRequest"("ngoId", "status");
CREATE INDEX "RenewalRequest_donorId_idx" ON "RenewalRequest"("donorId");
ALTER TABLE "RenewalRequest" ADD CONSTRAINT "RenewalRequest_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ContractImpactReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ImpactStory" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractId" TEXT,
    "variant" "ImpactStoryVariant" NOT NULL,
    "status" "ImpactStoryStatus" NOT NULL DEFAULT 'DRAFT',
    "generator" "ImpactStoryGenerator" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceFeedbackIds" TEXT[],
    "sourceEvidenceIds" TEXT[],
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "publishedAt" TIMESTAMP(3),
    "regenerationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImpactStory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImpactStory_ngoId_status_idx" ON "ImpactStory"("ngoId", "status");
CREATE INDEX "ImpactStory_projectId_variant_status_idx" ON "ImpactStory"("projectId", "variant", "status");
CREATE INDEX "ImpactStory_status_idx" ON "ImpactStory"("status");

CREATE TABLE "ContractExpense" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractMilestoneId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "spentOn" TIMESTAMP(3) NOT NULL,
    "receiptKey" TEXT,
    "receiptMime" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractExpense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContractExpense_idempotencyKey_key" ON "ContractExpense"("idempotencyKey");
CREATE INDEX "ContractExpense_contractId_idx" ON "ContractExpense"("contractId");
CREATE INDEX "ContractExpense_contractMilestoneId_idx" ON "ContractExpense"("contractMilestoneId");

CREATE TABLE "NgoRegistrationDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RegistrationDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "fields" JSONB NOT NULL,
    "documents" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "profileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NgoRegistrationDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NgoRegistrationDraft_userId_key" ON "NgoRegistrationDraft"("userId");
