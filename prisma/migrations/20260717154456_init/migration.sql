-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DONOR', 'NGO', 'ADMIN');

-- CreateEnum
CREATE TYPE "DonorPersona" AS ENUM ('INDIVIDUAL', 'CSR_OFFICER', 'HNI', 'FOUNDATION', 'GOVERNMENT');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'PAUSED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PROOF_SUBMITTED', 'VERIFIED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DonationStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DonorCategory" AS ENUM ('INDIAN_IN_INDIA', 'INDIAN_ABROAD', 'FOREIGN_NATIONAL');

-- CreateEnum
CREATE TYPE "FCRAStatus" AS ENUM ('NONE', 'PENDING', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'REJECTED', 'REUPLOAD_REQUESTED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'FINANCE', 'FIELD_STAFF');

-- CreateEnum
CREATE TYPE "AlertCategory" AS ENUM ('DOCUMENT_ERROR', 'FRAUD_ALERT');

-- CreateEnum
CREATE TYPE "AlertSubType" AS ENUM ('MISSING_DOCUMENT', 'WRONG_DOCUMENT_TYPE', 'EXPIRED_DOCUMENT', 'UNREADABLE_DOCUMENT', 'NAME_MISMATCH', 'DUPLICATE_IDENTITY', 'PAN_API_MISMATCH', 'FAKE_REGISTRATION', 'TAMPERED_DOCUMENT');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('ACCOUNT_CREATION', 'DONATION_DATA_SHARING');

-- CreateEnum
CREATE TYPE "DonorTier" AS ENUM ('STANDARD', 'COMMITTED', 'MAJOR_DONOR');

-- CreateEnum
CREATE TYPE "PanVerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILED', 'PROVIDER_ERROR');

-- CreateEnum
CREATE TYPE "PanVerifiedVia" AS ENUM ('MOCK', 'SUREPASS', 'MANUAL_ADMIN');

-- CreateEnum
CREATE TYPE "ReEngagementPath" AS ENUM ('TIER_UPGRADE', 'NGO_REFERRAL', 'GRANT_MODE', 'VOLUNTEER_ADVISOR');

-- CreateEnum
CREATE TYPE "DraftProofStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ThreadKind" AS ENUM ('INQUIRY', 'APPEAL');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('OPEN', 'NGO_RESPONDED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ImpactEventType" AS ENUM ('PROOF_SUBMITTED', 'MILESTONE_COMPLETED', 'UPDATE_POSTED', 'FIELD_PHOTO');

-- CreateEnum
CREATE TYPE "ImpactChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "ImpactDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'DONOR',
    "name" TEXT NOT NULL DEFAULT 'Anonymous',
    "avatar" TEXT,
    "googleId" TEXT,
    "panNumber" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "billingAddress" TEXT,
    "totalDonated" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "fcmToken" TEXT,
    "companyName" TEXT,
    "isCorporate" BOOLEAN NOT NULL DEFAULT false,
    "gstNumber" TEXT,
    "donorCategory" "DonorCategory",
    "donorCategoryDeclaredAt" TIMESTAMP(3),
    "donorDeclarationVersion" TEXT,
    "nriSourceDeclaration" TEXT,
    "donorPersona" "DonorPersona",
    "personaSetAt" TIMESTAMP(3),
    "panStatus" "PanVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "panVerifiedAt" TIMESTAMP(3),
    "panVerifiedVia" "PanVerifiedVia",
    "panRegisteredName" TEXT,
    "panNameMatch" BOOLEAN,
    "hniAdvisorName" TEXT,
    "hniAdvisorEmail" TEXT,
    "hniAnnualBudget" DECIMAL(12,2),
    "csrRegistrationNumber" TEXT,
    "csrBudget" DECIMAL(12,2),
    "trustRegistrationId" TEXT,
    "trust12a80gRegNo" TEXT,
    "trustAnnualBudget" DECIMAL(12,2),
    "donorTier" "DonorTier" NOT NULL DEFAULT 'STANDARD',
    "reEngagementPath" "ReEngagementPath",
    "volunteerInterest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NGOProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "panNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "causeCategories" TEXT[],
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "healthScore" DECIMAL(5,2),
    "healthScoreBreakdown" JSONB,
    "ai_verification_report" JSONB,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "suspensionReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "documents" TEXT[],
    "description" TEXT NOT NULL,
    "website" TEXT,
    "foundedYear" INTEGER NOT NULL,
    "adminNote" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "logo_url" TEXT,
    "cover_image_url" TEXT,
    "joinCode" TEXT,
    "dataProcessingConsent" BOOLEAN NOT NULL DEFAULT false,
    "dataProcessingConsentDate" TIMESTAMP(3),
    "consentVersion" TEXT,
    "consentIpAddress" TEXT,
    "consentRevoked" BOOLEAN NOT NULL DEFAULT false,
    "consentRevokedAt" TIMESTAMP(3),

    CONSTRAINT "NGOProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NGOTeamMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'FIELD_STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NGOTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NGOCompliance" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "panVerified" BOOLEAN NOT NULL DEFAULT false,
    "panVerifiedAt" TIMESTAMP(3),
    "registrationVerified" BOOLEAN NOT NULL DEFAULT false,
    "registrationVerifiedAt" TIMESTAMP(3),
    "a12Verified" BOOLEAN NOT NULL DEFAULT false,
    "a12VerifiedAt" TIMESTAMP(3),
    "a12DocumentUrl" TEXT,
    "eightyGVerified" BOOLEAN NOT NULL DEFAULT false,
    "eightyGVerifiedAt" TIMESTAMP(3),
    "fcraNumber" TEXT,
    "fcraStatus" "FCRAStatus" NOT NULL DEFAULT 'NONE',
    "fcraAuthority" TEXT DEFAULT 'Ministry of Home Affairs',
    "fcraRegisteredSince" INTEGER,
    "fcraIssueDate" TIMESTAMP(3),
    "fcraExpiryDate" TIMESTAMP(3),
    "fcraCertificateUrl" TEXT,
    "fcraExtractedData" JSONB,
    "fcraAdminNote" TEXT,
    "fcraVerifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NGOCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceAuditLog" (
    "id" TEXT NOT NULL,
    "complianceId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "causeCategory" TEXT NOT NULL,
    "targetAmount" DECIMAL(10,2) NOT NULL,
    "raisedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "coverImage" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "district_name" TEXT,
    "state_name" TEXT,
    "geo_intelligence" JSONB,
    "geo_fetched_at" TIMESTAMP(3),
    "problem_statement" TEXT,
    "expected_outcome" TEXT,
    "toc_analysis" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "aiScreeningScore" INTEGER,
    "aiScreeningResult" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetAmount" DECIMAL(10,2) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "sequenceOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneProof" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "documentUrls" TEXT[],
    "aiValidationResult" TEXT,
    "aiValidationScore" INTEGER,
    "theoryOfChangeAlignmentScore" INTEGER,
    "theoryOfChangeReasoning" TEXT,
    "theoryOfChangeStrengths" TEXT[],
    "theoryOfChangeGaps" TEXT[],
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneReview" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "proofId" TEXT,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "aiScore" INTEGER,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donation" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "status" "DonationStatus" NOT NULL DEFAULT 'PENDING',
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "milestoneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "retryToken" TEXT,
    "retryTokenExpiresAt" TIMESTAMP(3),
    "complianceSnapshot" JSONB,

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactReport" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "aiGeneratedNarrative" TEXT NOT NULL,
    "sdgTags" TEXT[],
    "irisMetrics" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "ImpactReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NGOFollower" (
    "donorId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "followedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NGOFollower_pkey" PRIMARY KEY ("donorId","ngoId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxReceipt" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitLog" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NgoScreening" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "extractedFields" JSONB NOT NULL,
    "documentChecklist" JSONB NOT NULL,
    "consistencyOk" BOOLEAN NOT NULL,
    "flags" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NgoScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "alertCategory" "AlertCategory" NOT NULL DEFAULT 'FRAUD_ALERT',
    "subType" "AlertSubType",
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskReview" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "alertIds" TEXT[],
    "riskScore" DOUBLE PRECISION,
    "riskLevel" TEXT NOT NULL,
    "findings" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RiskReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FcraQuarterlyReport" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalNgos" INTEGER NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "expiringSoonCount" INTEGER NOT NULL,
    "expiredCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "ngoBreakdown" JSONB NOT NULL,
    "generatedById" TEXT,

    CONSTRAINT "FcraQuarterlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "policyVersion" TEXT NOT NULL DEFAULT '1.0',
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "ConsentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReEngagementEvent" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "path" "ReEngagementPath" NOT NULL,
    "emailSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ctaClickedAt" TIMESTAMP(3),
    "dismissed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReEngagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAudit" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldWorker" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPending" BOOLEAN NOT NULL DEFAULT false,
    "reliabilityScore" INTEGER NOT NULL DEFAULT 100,
    "totalSubmissions" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftProof" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "fieldWorkerId" TEXT,
    "fingerprint" TEXT,
    "predictedProjectId" TEXT,
    "predictedMilestoneId" TEXT,
    "predictionConfidence" DOUBLE PRECISION,
    "senderPhone" TEXT NOT NULL,
    "rawMessage" TEXT NOT NULL,
    "aiSummary" TEXT,
    "riskLevel" TEXT,
    "riskReason" TEXT,
    "workerStatus" TEXT DEFAULT 'PENDING',
    "rawGpsLat" DOUBLE PRECISION,
    "rawGpsLng" DOUBLE PRECISION,
    "photoCount" INTEGER DEFAULT 0,
    "mediaUrls" TEXT[],
    "persistentPhotoUrls" TEXT[],
    "imageHashes" TEXT[],
    "status" "DraftProofStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PitchLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloaded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PitchLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminActionLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "note" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonorEvent" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "initiatedBy" TEXT,
    "source" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptEvent" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewThread" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "participantUserId" TEXT NOT NULL,
    "kind" "ThreadKind" NOT NULL DEFAULT 'INQUIRY',
    "subject" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "status" "ThreadStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectImpactEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "type" "ImpactEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectImpactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactSubscription" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP', 'EMAIL']::TEXT[],
    "frequency" TEXT NOT NULL DEFAULT 'INSTANT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "channel" "ImpactChannel" NOT NULL,
    "status" "ImpactDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'FIELD_STAFF',
    "ngoId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "NGOProfile_userId_key" ON "NGOProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NGOProfile_registrationNumber_key" ON "NGOProfile"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "NGOProfile_panNumber_key" ON "NGOProfile"("panNumber");

-- CreateIndex
CREATE UNIQUE INDEX "NGOProfile_joinCode_key" ON "NGOProfile"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "NGOTeamMember_userId_ngoId_key" ON "NGOTeamMember"("userId", "ngoId");

-- CreateIndex
CREATE UNIQUE INDEX "NGOCompliance_ngoId_key" ON "NGOCompliance"("ngoId");

-- CreateIndex
CREATE INDEX "ComplianceAuditLog_complianceId_idx" ON "ComplianceAuditLog"("complianceId");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_retryToken_key" ON "Donation"("retryToken");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReceipt_donationId_key" ON "TaxReceipt"("donationId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxReceipt_receiptNumber_key" ON "TaxReceipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "NgoScreening_ngoId_key" ON "NgoScreening"("ngoId");

-- CreateIndex
CREATE UNIQUE INDEX "FcraQuarterlyReport_quarter_key" ON "FcraQuarterlyReport"("quarter");

-- CreateIndex
CREATE INDEX "ConsentLog_userId_idx" ON "ConsentLog"("userId");

-- CreateIndex
CREATE INDEX "ReEngagementEvent_donorId_idx" ON "ReEngagementEvent"("donorId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldWorker_phone_key" ON "FieldWorker"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "DraftProof_fingerprint_key" ON "DraftProof"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PitchLead_email_key" ON "PitchLead"("email");

-- CreateIndex
CREATE INDEX "AdminActionLog_entityType_entityId_idx" ON "AdminActionLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AdminActionLog_adminId_idx" ON "AdminActionLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminActionLog_createdAt_idx" ON "AdminActionLog"("createdAt");

-- CreateIndex
CREATE INDEX "DonorEvent_donorId_idx" ON "DonorEvent"("donorId");

-- CreateIndex
CREATE INDEX "DonorEvent_eventType_idx" ON "DonorEvent"("eventType");

-- CreateIndex
CREATE INDEX "ReceiptEvent_receiptId_idx" ON "ReceiptEvent"("receiptId");

-- CreateIndex
CREATE INDEX "ReviewThread_subjectType_subjectId_idx" ON "ReviewThread"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ReviewThread_status_idx" ON "ReviewThread"("status");

-- CreateIndex
CREATE INDEX "ReviewMessage_threadId_idx" ON "ReviewMessage"("threadId");

-- CreateIndex
CREATE INDEX "ProjectImpactEvent_projectId_idx" ON "ProjectImpactEvent"("projectId");

-- CreateIndex
CREATE INDEX "ProjectImpactEvent_createdAt_idx" ON "ProjectImpactEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ImpactSubscription_projectId_idx" ON "ImpactSubscription"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactSubscription_donorId_projectId_key" ON "ImpactSubscription"("donorId", "projectId");

-- CreateIndex
CREATE INDEX "ImpactDelivery_status_attempts_idx" ON "ImpactDelivery"("status", "attempts");

-- CreateIndex
CREATE INDEX "ImpactDelivery_donorId_idx" ON "ImpactDelivery"("donorId");

-- CreateIndex
CREATE UNIQUE INDEX "ImpactDelivery_eventId_donorId_channel_key" ON "ImpactDelivery"("eventId", "donorId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_email_ngoId_key" ON "TeamInvite"("email", "ngoId");

-- AddForeignKey
ALTER TABLE "NGOProfile" ADD CONSTRAINT "NGOProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NGOTeamMember" ADD CONSTRAINT "NGOTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NGOTeamMember" ADD CONSTRAINT "NGOTeamMember_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NGOCompliance" ADD CONSTRAINT "NGOCompliance_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceAuditLog" ADD CONSTRAINT "ComplianceAuditLog_complianceId_fkey" FOREIGN KEY ("complianceId") REFERENCES "NGOCompliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReview" ADD CONSTRAINT "ProjectReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReview" ADD CONSTRAINT "ProjectReview_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneProof" ADD CONSTRAINT "MilestoneProof_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneProof" ADD CONSTRAINT "MilestoneProof_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneReview" ADD CONSTRAINT "MilestoneReview_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneReview" ADD CONSTRAINT "MilestoneReview_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactReport" ADD CONSTRAINT "ImpactReport_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactReport" ADD CONSTRAINT "ImpactReport_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactReport" ADD CONSTRAINT "ImpactReport_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NGOFollower" ADD CONSTRAINT "NGOFollower_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NGOFollower" ADD CONSTRAINT "NGOFollower_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxReceipt" ADD CONSTRAINT "TaxReceipt_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NgoScreening" ADD CONSTRAINT "NgoScreening_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLog" ADD CONSTRAINT "ConsentLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReEngagementEvent" ADD CONSTRAINT "ReEngagementEvent_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldWorker" ADD CONSTRAINT "FieldWorker_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftProof" ADD CONSTRAINT "DraftProof_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftProof" ADD CONSTRAINT "DraftProof_fieldWorkerId_fkey" FOREIGN KEY ("fieldWorkerId") REFERENCES "FieldWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMessage" ADD CONSTRAINT "ReviewMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ReviewThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactDelivery" ADD CONSTRAINT "ImpactDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ProjectImpactEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

