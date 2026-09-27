-- CreateEnum
CREATE TYPE "OrgVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cin" TEXT,
ADD COLUMN     "orgSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "orgVerificationNote" TEXT,
ADD COLUMN     "orgVerificationStatus" "OrgVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN     "orgVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "orgVerifiedById" TEXT;

-- CreateIndex
CREATE INDEX "User_orgVerificationStatus_idx" ON "User"("orgVerificationStatus");
