-- Workstream D: contract milestone funding, payment→milestone allocation
-- approval, UTR capture and the unmatched-bank-line exception. Additive only.

-- CreateEnum
CREATE TYPE "MilestoneFundingStatus" AS ENUM ('UNFUNDED', 'PARTIALLY_FUNDED', 'FUNDED');

-- CreateEnum
CREATE TYPE "PaymentAllocationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "FinanceExceptionType" ADD VALUE 'UNMATCHED_BANK_LINE';

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "fundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContractMilestone" ADD COLUMN "fundingStatus" "MilestoneFundingStatus" NOT NULL DEFAULT 'UNFUNDED',
ADD COLUMN "fundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ContractPayment" ADD COLUMN "utr" TEXT,
ADD COLUMN "payerAccountId" TEXT;

-- CreateTable
CREATE TABLE "ContractPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractMilestoneId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "rule" TEXT NOT NULL,
    "status" "PaymentAllocationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractPayment_payerAccountId_utr_key" ON "ContractPayment"("payerAccountId", "utr");

-- CreateIndex
CREATE INDEX "ContractPaymentAllocation_contractId_idx" ON "ContractPaymentAllocation"("contractId");

-- CreateIndex
CREATE INDEX "ContractPaymentAllocation_contractMilestoneId_idx" ON "ContractPaymentAllocation"("contractMilestoneId");

-- CreateIndex
CREATE INDEX "ContractPaymentAllocation_status_idx" ON "ContractPaymentAllocation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContractPaymentAllocation_paymentId_contractMilestoneId_key" ON "ContractPaymentAllocation"("paymentId", "contractMilestoneId");

-- AddForeignKey
ALTER TABLE "ContractPaymentAllocation" ADD CONSTRAINT "ContractPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ContractPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPaymentAllocation" ADD CONSTRAINT "ContractPaymentAllocation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPaymentAllocation" ADD CONSTRAINT "ContractPaymentAllocation_contractMilestoneId_fkey" FOREIGN KEY ("contractMilestoneId") REFERENCES "ContractMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: payments already recorded keep their reference; the payer scope is
-- the contract's donor account.
UPDATE "ContractPayment" p SET "payerAccountId" = c."donorId" FROM "Contract" c WHERE p."contractId" = c."id" AND p."payerAccountId" IS NULL;
