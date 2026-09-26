-- CreateEnum
CREATE TYPE "RiskAction" AS ENUM ('INVESTIGATE', 'EXTRACT', 'MONITOR');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "RiskDispatch" (
    "id" TEXT NOT NULL,
    "entityType" "RiskEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "RiskAction" NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'QUEUED',
    "scoreAtQueue" INTEGER NOT NULL,
    "bandAtQueue" "RiskBand" NOT NULL,
    "reason" TEXT NOT NULL,
    "resultRef" TEXT,
    "error" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "RiskDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskDispatch_status_scoreAtQueue_idx" ON "RiskDispatch"("status", "scoreAtQueue");

-- CreateIndex
CREATE INDEX "RiskDispatch_entityType_entityId_status_idx" ON "RiskDispatch"("entityType", "entityId", "status");
