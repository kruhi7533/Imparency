-- CreateEnum
CREATE TYPE "NgoDocumentType" AS ENUM ('REGISTRATION_CERTIFICATE', 'PAN_CARD', 'TAX_EXEMPTION_12A', 'TAX_EXEMPTION_80G', 'FCRA_CERTIFICATE', 'BANK_PROOF', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('EXTRACTED', 'NEEDS_REVIEW', 'VALIDATED', 'REJECTED');

-- CreateTable
CREATE TABLE "NgoDocumentAnalysis" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "documentIndex" INTEGER NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "docType" "NgoDocumentType" NOT NULL DEFAULT 'UNKNOWN',
    "docTypeConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "readable" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NgoDocumentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedField" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "analysisId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "extractedValue" TEXT,
    "submittedValue" TEXT,
    "matchesSubmitted" BOOLEAN,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "flags" JSONB NOT NULL DEFAULT '[]',
    "validatedValue" TEXT,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NgoDocumentAnalysis_ngoId_idx" ON "NgoDocumentAnalysis"("ngoId");

-- CreateIndex
CREATE UNIQUE INDEX "NgoDocumentAnalysis_ngoId_documentIndex_key" ON "NgoDocumentAnalysis"("ngoId", "documentIndex");

-- CreateIndex
CREATE INDEX "ExtractedField_ngoId_idx" ON "ExtractedField"("ngoId");

-- CreateIndex
CREATE INDEX "ExtractedField_status_idx" ON "ExtractedField"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedField_ngoId_fieldKey_key" ON "ExtractedField"("ngoId", "fieldKey");

-- AddForeignKey
ALTER TABLE "NgoDocumentAnalysis" ADD CONSTRAINT "NgoDocumentAnalysis_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedField" ADD CONSTRAINT "ExtractedField_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "NgoDocumentAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
