-- Hot-path indexes for the original core tables.
--
-- Prisma only emits indexes for @id and field-level @unique, and PostgreSQL
-- (unlike MySQL) does not index foreign keys automatically. The result was that
-- Donation, Project, Milestone, FraudAlert, RiskReview, MilestoneProof,
-- MilestoneReview, ProjectReview, ImpactReport and Notification had nothing but
-- a primary key, so every lookup by owner, status or foreign key was a
-- sequential scan. pg_stat_user_tables showed Notification, MilestoneReview and
-- ProjectReview with ZERO index scans, ever.
--
-- This is invisible today — a scan over a handful of rows is faster than an
-- index — and it is not expected to change any current timing. It is added now
-- because the cost of a sequential scan is linear in table size, and because
-- creating these on a large, busy table later would need CONCURRENTLY and a
-- maintenance window, whereas right now it is a no-op.
--
-- Every column indexed here was chosen from an actual WHERE/orderBy in the
-- codebase, not speculatively; see the comments on each model in schema.prisma.
-- Purely additive: no drops, no data changes.

-- CreateIndex
CREATE INDEX "Donation_projectId_idx" ON "Donation"("projectId");

-- CreateIndex
CREATE INDEX "Donation_donorId_status_idx" ON "Donation"("donorId", "status");

-- CreateIndex
CREATE INDEX "Donation_status_createdAt_idx" ON "Donation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Donation_razorpayOrderId_idx" ON "Donation"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "FraudAlert_resolved_severity_idx" ON "FraudAlert"("resolved", "severity");

-- CreateIndex
CREATE INDEX "FraudAlert_type_entityId_resolved_idx" ON "FraudAlert"("type", "entityId", "resolved");

-- CreateIndex
CREATE INDEX "FraudAlert_entityId_idx" ON "FraudAlert"("entityId");

-- CreateIndex
CREATE INDEX "ImpactReport_donationId_idx" ON "ImpactReport"("donationId");

-- CreateIndex
CREATE INDEX "ImpactReport_donorId_idx" ON "ImpactReport"("donorId");

-- CreateIndex
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");

-- CreateIndex
CREATE INDEX "Milestone_status_deadline_idx" ON "Milestone"("status", "deadline");

-- CreateIndex
CREATE INDEX "MilestoneProof_milestoneId_idx" ON "MilestoneProof"("milestoneId");

-- CreateIndex
CREATE INDEX "MilestoneReview_milestoneId_idx" ON "MilestoneReview"("milestoneId");

-- CreateIndex
CREATE INDEX "NGOProfile_verificationStatus_isDeleted_isSuspended_idx" ON "NGOProfile"("verificationStatus", "isDeleted", "isSuspended");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_ngoId_idx" ON "Project"("ngoId");

-- CreateIndex
CREATE INDEX "Project_status_isDeleted_idx" ON "Project"("status", "isDeleted");

-- CreateIndex
CREATE INDEX "ProjectReview_projectId_idx" ON "ProjectReview"("projectId");

-- CreateIndex
CREATE INDEX "RiskReview_ngoId_status_idx" ON "RiskReview"("ngoId", "status");

-- CreateIndex
CREATE INDEX "RiskReview_status_idx" ON "RiskReview"("status");

