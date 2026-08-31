-- CreateEnum
CREATE TYPE "RiskEntityType" AS ENUM ('NGO', 'DONOR');

-- CreateEnum
CREATE TYPE "RiskBand" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');

-- CreateTable
CREATE TABLE "EntityRiskScore" (
    "id" TEXT NOT NULL,
    "entityType" "RiskEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" "RiskBand" NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "unknownInputs" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityRiskScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityRiskScore_entityType_score_idx" ON "EntityRiskScore"("entityType", "score");

-- CreateIndex
CREATE INDEX "EntityRiskScore_entityType_band_idx" ON "EntityRiskScore"("entityType", "band");

-- CreateIndex
CREATE UNIQUE INDEX "EntityRiskScore_entityType_entityId_key" ON "EntityRiskScore"("entityType", "entityId");
