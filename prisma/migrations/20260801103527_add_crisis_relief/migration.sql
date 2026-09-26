-- CreateEnum
CREATE TYPE "DisasterType" AS ENUM ('FLOOD', 'EARTHQUAKE', 'CYCLONE', 'WILDFIRE', 'LANDSLIDE', 'DROUGHT', 'WAR_CONFLICT', 'EPIDEMIC', 'OTHER');

-- CreateEnum
CREATE TYPE "CrisisSeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CrisisStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "InitiativeStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CrisisDonationTarget" AS ENUM ('CRISIS_DIRECT', 'NGO_CAMPAIGN', 'INITIATIVE');

-- CreateEnum
CREATE TYPE "CrisisUpdateType" AS ENUM ('PHOTO', 'VIDEO', 'REPORT', 'FUND_UTILIZATION', 'BENEFICIARY_UPDATE', 'TEXT');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "crisisEventId" TEXT,
ADD COLUMN     "isCrisisGeneralFund" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "crisisAlertsOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CrisisEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "disasterType" "DisasterType" NOT NULL,
    "description" TEXT NOT NULL,
    "affectedLocation" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "stateName" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "severity" "CrisisSeverity" NOT NULL DEFAULT 'MODERATE',
    "coverImage" TEXT NOT NULL,
    "galleryImages" TEXT[],
    "status" "CrisisStatus" NOT NULL DEFAULT 'UPCOMING',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedEndDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "totalRaised" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "totalDonors" INTEGER NOT NULL DEFAULT 0,
    "totalCampaigns" INTEGER NOT NULL DEFAULT 0,
    "totalNgos" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrisisEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrisisParticipant" (
    "id" TEXT NOT NULL,
    "crisisEventId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrisisParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReliefInitiative" (
    "id" TEXT NOT NULL,
    "crisisEventId" TEXT,
    "submittedById" TEXT NOT NULL,
    "organizerName" TEXT NOT NULL,
    "organizerType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "requiredFunds" DECIMAL(12,2) NOT NULL,
    "raisedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "totalDonors" INTEGER NOT NULL DEFAULT 0,
    "bankAccountName" TEXT NOT NULL,
    "bankAccountNumberEnc" TEXT NOT NULL,
    "bankIfsc" TEXT NOT NULL,
    "bankProofUrl" TEXT NOT NULL,
    "images" TEXT[],
    "documents" TEXT[],
    "status" "InitiativeStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReliefInitiative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrisisDonation" (
    "id" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "crisisEventId" TEXT NOT NULL,
    "targetType" "CrisisDonationTarget" NOT NULL,
    "campaignProjectId" TEXT,
    "initiativeId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "status" "DonationStatus" NOT NULL DEFAULT 'PENDING',
    "receiptUrl" TEXT,
    "complianceSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrisisDonation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrisisUpdate" (
    "id" TEXT NOT NULL,
    "crisisEventId" TEXT NOT NULL,
    "postedById" TEXT NOT NULL,
    "postedByNgoId" TEXT,
    "initiativeId" TEXT,
    "type" "CrisisUpdateType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "documentUrls" TEXT[],
    "fundsUtilized" DECIMAL(12,2),
    "beneficiariesReached" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrisisUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrisisNotificationDelivery" (
    "id" TEXT NOT NULL,
    "crisisEventId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "channel" "ImpactChannel" NOT NULL,
    "status" "ImpactDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrisisNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrisisEvent_slug_key" ON "CrisisEvent"("slug");

-- CreateIndex
CREATE INDEX "CrisisEvent_status_idx" ON "CrisisEvent"("status");

-- CreateIndex
CREATE INDEX "CrisisEvent_verificationStatus_idx" ON "CrisisEvent"("verificationStatus");

-- CreateIndex
CREATE INDEX "CrisisEvent_disasterType_idx" ON "CrisisEvent"("disasterType");

-- CreateIndex
CREATE INDEX "CrisisEvent_isFeatured_idx" ON "CrisisEvent"("isFeatured");

-- CreateIndex
CREATE INDEX "CrisisEvent_country_stateName_city_idx" ON "CrisisEvent"("country", "stateName", "city");

-- CreateIndex
CREATE INDEX "CrisisParticipant_ngoId_idx" ON "CrisisParticipant"("ngoId");

-- CreateIndex
CREATE UNIQUE INDEX "CrisisParticipant_crisisEventId_ngoId_key" ON "CrisisParticipant"("crisisEventId", "ngoId");

-- CreateIndex
CREATE INDEX "ReliefInitiative_status_idx" ON "ReliefInitiative"("status");

-- CreateIndex
CREATE INDEX "ReliefInitiative_crisisEventId_idx" ON "ReliefInitiative"("crisisEventId");

-- CreateIndex
CREATE INDEX "CrisisDonation_crisisEventId_idx" ON "CrisisDonation"("crisisEventId");

-- CreateIndex
CREATE INDEX "CrisisDonation_donorId_idx" ON "CrisisDonation"("donorId");

-- CreateIndex
CREATE INDEX "CrisisDonation_campaignProjectId_idx" ON "CrisisDonation"("campaignProjectId");

-- CreateIndex
CREATE INDEX "CrisisDonation_initiativeId_idx" ON "CrisisDonation"("initiativeId");

-- CreateIndex
CREATE INDEX "CrisisDonation_razorpayOrderId_idx" ON "CrisisDonation"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "CrisisUpdate_crisisEventId_createdAt_idx" ON "CrisisUpdate"("crisisEventId", "createdAt");

-- CreateIndex
CREATE INDEX "CrisisNotificationDelivery_status_attempts_idx" ON "CrisisNotificationDelivery"("status", "attempts");

-- CreateIndex
CREATE INDEX "CrisisNotificationDelivery_donorId_idx" ON "CrisisNotificationDelivery"("donorId");

-- CreateIndex
CREATE UNIQUE INDEX "CrisisNotificationDelivery_crisisEventId_donorId_channel_key" ON "CrisisNotificationDelivery"("crisisEventId", "donorId", "channel");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_crisisEventId_fkey" FOREIGN KEY ("crisisEventId") REFERENCES "CrisisEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisEvent" ADD CONSTRAINT "CrisisEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisParticipant" ADD CONSTRAINT "CrisisParticipant_crisisEventId_fkey" FOREIGN KEY ("crisisEventId") REFERENCES "CrisisEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisParticipant" ADD CONSTRAINT "CrisisParticipant_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReliefInitiative" ADD CONSTRAINT "ReliefInitiative_crisisEventId_fkey" FOREIGN KEY ("crisisEventId") REFERENCES "CrisisEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReliefInitiative" ADD CONSTRAINT "ReliefInitiative_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisDonation" ADD CONSTRAINT "CrisisDonation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisDonation" ADD CONSTRAINT "CrisisDonation_crisisEventId_fkey" FOREIGN KEY ("crisisEventId") REFERENCES "CrisisEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisDonation" ADD CONSTRAINT "CrisisDonation_campaignProjectId_fkey" FOREIGN KEY ("campaignProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisDonation" ADD CONSTRAINT "CrisisDonation_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "ReliefInitiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisUpdate" ADD CONSTRAINT "CrisisUpdate_crisisEventId_fkey" FOREIGN KEY ("crisisEventId") REFERENCES "CrisisEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisUpdate" ADD CONSTRAINT "CrisisUpdate_postedByNgoId_fkey" FOREIGN KEY ("postedByNgoId") REFERENCES "NGOProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisUpdate" ADD CONSTRAINT "CrisisUpdate_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "ReliefInitiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisNotificationDelivery" ADD CONSTRAINT "CrisisNotificationDelivery_crisisEventId_fkey" FOREIGN KEY ("crisisEventId") REFERENCES "CrisisEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrisisNotificationDelivery" ADD CONSTRAINT "CrisisNotificationDelivery_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

