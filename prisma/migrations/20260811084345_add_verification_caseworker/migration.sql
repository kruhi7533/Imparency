-- CreateEnum
CREATE TYPE "AgentCaseStatus" AS ENUM ('NEW', 'GATHERING', 'ANALYZING', 'AWAITING_NGO', 'AWAITING_ADMIN', 'RESOLVED', 'ESCALATED', 'ABANDONED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentStepKind" AS ENUM ('MODEL_CALL', 'TOOL_CALL', 'TOOL_RESULT', 'GATE', 'TRANSITION', 'ERROR');

-- CreateTable
CREATE TABLE "AgentCase" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "caseType" TEXT NOT NULL DEFAULT 'NGO_VERIFICATION',
    "status" "AgentCaseStatus" NOT NULL DEFAULT 'NEW',
    "stepsUsed" INTEGER NOT NULL DEFAULT 0,
    "stepBudget" INTEGER NOT NULL DEFAULT 12,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costPaise" INTEGER NOT NULL DEFAULT 0,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL DEFAULT '{}',
    "lockedUntil" TIMESTAMP(3),
    "lockedBy" TEXT,
    "waitingSince" TIMESTAMP(3),
    "nextWakeAt" TIMESTAMP(3),
    "summary" TEXT,
    "escalationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "AgentStepKind" NOT NULL,
    "toolName" TEXT,
    "args" JSONB,
    "result" JSONB,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "modelName" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPendingAction" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "stepSeq" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "finalArgs" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentCase_status_nextWakeAt_idx" ON "AgentCase"("status", "nextWakeAt");

-- CreateIndex
CREATE INDEX "AgentCase_lockedUntil_idx" ON "AgentCase"("lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCase_ngoId_caseType_key" ON "AgentCase"("ngoId", "caseType");

-- CreateIndex
CREATE INDEX "AgentStep_caseId_seq_idx" ON "AgentStep"("caseId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_caseId_seq_key" ON "AgentStep"("caseId", "seq");

-- CreateIndex
CREATE INDEX "AgentPendingAction_status_idx" ON "AgentPendingAction"("status");

-- CreateIndex
CREATE INDEX "AgentPendingAction_caseId_idx" ON "AgentPendingAction"("caseId");

-- AddForeignKey
ALTER TABLE "AgentCase" ADD CONSTRAINT "AgentCase_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AgentCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPendingAction" ADD CONSTRAINT "AgentPendingAction_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AgentCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
