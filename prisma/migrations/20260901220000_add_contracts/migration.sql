-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'ACTIVE', 'COMPLETED', 'TERMINATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContractMilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PROOF_SUBMITTED', 'VERIFIED', 'DISBURSED', 'WITHHELD');

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "donorId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requirementId" TEXT,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "totalGrantAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "governingLaw" TEXT NOT NULL DEFAULT 'Laws of India',
    "csrScheduleViiCategory" TEXT,
    "reportingCadence" TEXT NOT NULL DEFAULT 'QUARTERLY',
    "termsAndConditions" TEXT NOT NULL,
    "donorSignedAt" TIMESTAMP(3),
    "donorSignedByName" TEXT,
    "donorSignerTitle" TEXT,
    "donorSignerIp" TEXT,
    "ngoSignedAt" TIMESTAMP(3),
    "ngoSignedByName" TEXT,
    "ngoSignerTitle" TEXT,
    "ngoSignerIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractMilestone" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "projectMilestoneId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(10,2) NOT NULL,
    "status" "ContractMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "deliverables" TEXT[],
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAuditLog" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "detail" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractNumber_key" ON "Contract"("contractNumber");

-- CreateIndex
CREATE INDEX "Contract_donorId_idx" ON "Contract"("donorId");

-- CreateIndex
CREATE INDEX "Contract_ngoId_idx" ON "Contract"("ngoId");

-- CreateIndex
CREATE INDEX "Contract_projectId_idx" ON "Contract"("projectId");

-- CreateIndex
CREATE INDEX "Contract_status_idx" ON "Contract"("status");

-- CreateIndex
CREATE INDEX "ContractMilestone_contractId_idx" ON "ContractMilestone"("contractId");

-- CreateIndex
CREATE INDEX "ContractAuditLog_contractId_idx" ON "ContractAuditLog"("contractId");

-- CreateIndex
CREATE INDEX "ContractAuditLog_actorId_idx" ON "ContractAuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "SponsorRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractMilestone" ADD CONSTRAINT "ContractMilestone_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractAuditLog" ADD CONSTRAINT "ContractAuditLog_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
