-- CreateTable
CREATE TABLE "FundingOpportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "funderName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundingOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityCriterion" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT,
    "values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingJob" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "criteriaSnapshot" JSONB NOT NULL DEFAULT '[]',
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "evaluatedCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "ineligibleCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCandidate" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "decision" TEXT NOT NULL DEFAULT 'PROPOSED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingOpportunity_status_createdAt_idx" ON "FundingOpportunity"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OpportunityCriterion_opportunityId_idx" ON "OpportunityCriterion"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityCriterion_opportunityId_kind_key" ON "OpportunityCriterion"("opportunityId", "kind");

-- CreateIndex
CREATE INDEX "MatchingJob_opportunityId_idx" ON "MatchingJob"("opportunityId");

-- CreateIndex
CREATE INDEX "MatchingJob_opportunityId_status_idx" ON "MatchingJob"("opportunityId", "status");

-- CreateIndex
CREATE INDEX "MatchCandidate_jobId_idx" ON "MatchCandidate"("jobId");

-- CreateIndex
CREATE INDEX "MatchCandidate_ngoId_idx" ON "MatchCandidate"("ngoId");

-- CreateIndex
CREATE INDEX "MatchCandidate_jobId_verdict_idx" ON "MatchCandidate"("jobId", "verdict");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCandidate_jobId_ngoId_key" ON "MatchCandidate"("jobId", "ngoId");

-- AddForeignKey
ALTER TABLE "OpportunityCriterion" ADD CONSTRAINT "OpportunityCriterion_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "FundingOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingJob" ADD CONSTRAINT "MatchingJob_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "FundingOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MatchingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_ngoId_fkey" FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
