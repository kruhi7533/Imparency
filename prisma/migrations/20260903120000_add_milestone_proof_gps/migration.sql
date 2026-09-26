-- AlterTable
ALTER TABLE "MilestoneProof" ADD COLUMN     "proofLatitude" DOUBLE PRECISION,
ADD COLUMN     "proofLongitude" DOUBLE PRECISION,
ADD COLUMN     "gpsSource" TEXT;
