-- AlterTable
ALTER TABLE "Project" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ProjectRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetAmount" DECIMAL(10,2) NOT NULL,
    "milestonesData" JSONB,
    "changeSummary" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRevision_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SponsorRequirement" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "RequirementRevision" (
    "id" TEXT NOT NULL,
    "sponsorRequirementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "extractedFields" JSONB NOT NULL,
    "changeSummary" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectRevision_projectId_idx" ON "ProjectRevision"("projectId");

-- CreateIndex
CREATE INDEX "ProjectRevision_projectId_version_idx" ON "ProjectRevision"("projectId", "version");

-- CreateIndex
CREATE INDEX "RequirementRevision_sponsorRequirementId_idx" ON "RequirementRevision"("sponsorRequirementId");

-- CreateIndex
CREATE INDEX "RequirementRevision_sponsorRequirementId_version_idx" ON "RequirementRevision"("sponsorRequirementId", "version");

-- AddForeignKey
ALTER TABLE "ProjectRevision" ADD CONSTRAINT "ProjectRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRevision" ADD CONSTRAINT "ProjectRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRevision" ADD CONSTRAINT "RequirementRevision_sponsorRequirementId_fkey" FOREIGN KEY ("sponsorRequirementId") REFERENCES "SponsorRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementRevision" ADD CONSTRAINT "RequirementRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
