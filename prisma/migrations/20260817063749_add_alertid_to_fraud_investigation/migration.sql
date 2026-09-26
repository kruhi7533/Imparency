-- AlterTable
ALTER TABLE "FraudInvestigation" ADD COLUMN     "alertId" TEXT;

-- CreateIndex
CREATE INDEX "FraudInvestigation_alertId_idx" ON "FraudInvestigation"("alertId");
