-- AlterTable
ALTER TABLE "NGOProfile" ADD COLUMN     "reverificationDueAt" TIMESTAMP(3),
ADD COLUMN     "reverificationEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "reverificationReason" TEXT,
ADD COLUMN     "reverificationRequiredAt" TIMESTAMP(3);
