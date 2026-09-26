-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "FraudInvestigation" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredBy" TEXT NOT NULL,
    "stepsUsed" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "trace" JSONB NOT NULL DEFAULT '[]',
    "riskLevel" TEXT,
    "summary" TEXT,
    "riskReviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudInvestigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FraudInvestigation_ngoId_idx" ON "FraudInvestigation"("ngoId");

-- CreateIndex
CREATE INDEX "FraudInvestigation_status_idx" ON "FraudInvestigation"("status");

-- AddForeignKey
ALTER TABLE "FraudInvestigation" ADD CONSTRAINT "FraudInvestigation_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
