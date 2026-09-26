-- AlterTable
ALTER TABLE "FundingOpportunity" ADD COLUMN     "funderUserId" TEXT;

-- CreateIndex
CREATE INDEX "FundingOpportunity_funderUserId_idx" ON "FundingOpportunity"("funderUserId");

-- AddForeignKey
ALTER TABLE "FundingOpportunity" ADD CONSTRAINT "FundingOpportunity_funderUserId_fkey" FOREIGN KEY ("funderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
