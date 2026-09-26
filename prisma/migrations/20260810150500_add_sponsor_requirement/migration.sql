-- CreateTable
CREATE TABLE "SponsorRequirement" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT,
    "rawDocumentUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "extractedFields" JSONB NOT NULL,
    "confidenceScores" JSONB NOT NULL,
    "extractionStatus" TEXT NOT NULL,
    "extractedByAgent" TEXT NOT NULL DEFAULT 'RequirementsAnalystAgent',
    "modelVersion" TEXT NOT NULL DEFAULT 'gpt-4o',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "status" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsorRequirement_sponsorId_idx" ON "SponsorRequirement"("sponsorId");

-- CreateIndex
CREATE INDEX "SponsorRequirement_fileHash_idx" ON "SponsorRequirement"("fileHash");

-- CreateIndex
CREATE INDEX "AgentExecution_agentName_idx" ON "AgentExecution"("agentName");

-- CreateIndex
CREATE INDEX "AgentExecution_entityId_idx" ON "AgentExecution"("entityId");

-- AddForeignKey
ALTER TABLE "SponsorRequirement" ADD CONSTRAINT "SponsorRequirement_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
