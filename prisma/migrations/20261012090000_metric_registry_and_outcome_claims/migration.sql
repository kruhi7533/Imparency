-- Week 8: Metric Registry + governed outcome claims.
-- See docs/WEEK8-BLUEPRINT.md. Written by hand and additively, per CLAUDE.md:
-- `prisma migrate dev` fails at the shadow database on this project, and the
-- shared Neon dev DB contains tables this schema does not know about, so a
-- generated diff would propose dropping them.
--
-- Every statement is IF NOT EXISTS / additive. Nothing existing is altered,
-- renamed or dropped, so this is safe to replay and safe to deploy ahead of
-- the application code.

-- ---------------------------------------------------------------------------
-- Enums. CREATE TYPE has no IF NOT EXISTS before PG 9.6-era syntax rules, so
-- each is wrapped to keep the migration re-runnable.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "MetricStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MetricUnit" AS ENUM (
    'COUNT_PEOPLE', 'COUNT_ITEMS', 'COUNT_EVENTS', 'CURRENCY_INR',
    'PERCENTAGE', 'HOURS', 'KILOGRAMS', 'LITRES', 'AREA_SQM'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EvidenceKind" AS ENUM (
    'MILESTONE_PROOF', 'FIELD_PHOTO', 'BENEFICIARY_FEEDBACK',
    'ATTENDANCE_RECORD', 'FINANCIAL_RECORD'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OutcomeClaimStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'NEEDS_EVIDENCE', 'APPROVED', 'REJECTED', 'WITHDRAWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- MetricDefinition — `code` is the primary key, not a uuid: the code is the
-- contract published to the NGO track and printed in donor reports.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "MetricDefinition" (
  "code"             TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "unit"             "MetricUnit" NOT NULL,
  "definition"       TEXT NOT NULL,
  "status"           "MetricStatus" NOT NULL DEFAULT 'DRAFT',
  "sdgGoals"         TEXT[],
  "irisCode"         TEXT,
  "requiredEvidence" "EvidenceKind"[],
  "aggregatable"     BOOLEAN NOT NULL DEFAULT true,
  "version"          INTEGER NOT NULL DEFAULT 1,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("code")
);

CREATE INDEX IF NOT EXISTS "MetricDefinition_status_idx" ON "MetricDefinition"("status");

-- ---------------------------------------------------------------------------
-- OutcomeClaim — a number reported against a governed metric.
-- `value` is NUMERIC(14,2), never a float: an impact figure quoted to a funder
-- gets the same treatment as a rupee amount (CLAUDE.md §Finance).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "OutcomeClaim" (
  "id"             TEXT NOT NULL,
  "ngoId"          TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "milestoneId"    TEXT,
  "metricCode"     TEXT NOT NULL,
  "value"          DECIMAL(14,2) NOT NULL,
  "unit"           "MetricUnit" NOT NULL,
  "periodStart"    TIMESTAMP(3) NOT NULL,
  "periodEnd"      TIMESTAMP(3) NOT NULL,
  "method"         TEXT NOT NULL,
  "status"         "OutcomeClaimStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedById"  TEXT,
  "submittedAt"    TIMESTAMP(3),
  "decidedById"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "decisionNote"   TEXT,
  "supersededById" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutcomeClaim_pkey" PRIMARY KEY ("id")
);

-- The admin review queue: everything SUBMITTED, oldest first.
CREATE INDEX IF NOT EXISTS "OutcomeClaim_status_submittedAt_idx" ON "OutcomeClaim"("status", "submittedAt");
CREATE INDEX IF NOT EXISTS "OutcomeClaim_ngoId_status_idx"       ON "OutcomeClaim"("ngoId", "status");
CREATE INDEX IF NOT EXISTS "OutcomeClaim_projectId_idx"          ON "OutcomeClaim"("projectId");
CREATE INDEX IF NOT EXISTS "OutcomeClaim_metricCode_status_idx"  ON "OutcomeClaim"("metricCode", "status");

-- ---------------------------------------------------------------------------
-- OutcomeClaimEvidence — the citation join.
--
-- An explicit table rather than an array of ids because the load-bearing query
-- runs FROM the evidence side: "is this evidence already counted by another
-- approved claim on this metric?" That is the double-counting check in
-- lib/outcome-triage.ts, and on an array column it would be a scan.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "OutcomeClaimEvidence" (
  "id"         TEXT NOT NULL,
  "claimId"    TEXT NOT NULL,
  "kind"       "EvidenceKind" NOT NULL,
  "proofId"    TEXT,
  "evidenceId" TEXT,
  "feedbackId" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutcomeClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- The same evidence cannot be cited twice by one claim: that would inflate
-- what the citations "support" against the claim's own value.
CREATE UNIQUE INDEX IF NOT EXISTS "OutcomeClaimEvidence_claimId_proofId_evidenceId_feedbackId_key"
  ON "OutcomeClaimEvidence"("claimId", "proofId", "evidenceId", "feedbackId");

CREATE INDEX IF NOT EXISTS "OutcomeClaimEvidence_proofId_idx"    ON "OutcomeClaimEvidence"("proofId");
CREATE INDEX IF NOT EXISTS "OutcomeClaimEvidence_evidenceId_idx" ON "OutcomeClaimEvidence"("evidenceId");
CREATE INDEX IF NOT EXISTS "OutcomeClaimEvidence_feedbackId_idx" ON "OutcomeClaimEvidence"("feedbackId");

-- ---------------------------------------------------------------------------
-- Foreign keys. Added separately and guarded, so a replay against a database
-- that already has the tables does not fail on a duplicate constraint.
--
-- ON DELETE CASCADE on the citation targets is deliberate: a deleted piece of
-- evidence must take its citation with it. A citation pointing at nothing is a
-- silently inflated total, which is the exact failure this module prevents.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "OutcomeClaim" ADD CONSTRAINT "OutcomeClaim_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutcomeClaim" ADD CONSTRAINT "OutcomeClaim_milestoneId_fkey"
    FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No ON DELETE CASCADE here: a metric is never deleted, only DEPRECATED.
-- Deleting one would silently rewrite numbers already sent to donors.
DO $$ BEGIN
  ALTER TABLE "OutcomeClaim" ADD CONSTRAINT "OutcomeClaim_metricCode_fkey"
    FOREIGN KEY ("metricCode") REFERENCES "MetricDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutcomeClaimEvidence" ADD CONSTRAINT "OutcomeClaimEvidence_claimId_fkey"
    FOREIGN KEY ("claimId") REFERENCES "OutcomeClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutcomeClaimEvidence" ADD CONSTRAINT "OutcomeClaimEvidence_proofId_fkey"
    FOREIGN KEY ("proofId") REFERENCES "MilestoneProof"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutcomeClaimEvidence" ADD CONSTRAINT "OutcomeClaimEvidence_evidenceId_fkey"
    FOREIGN KEY ("evidenceId") REFERENCES "FieldEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OutcomeClaimEvidence" ADD CONSTRAINT "OutcomeClaimEvidence_feedbackId_fkey"
    FOREIGN KEY ("feedbackId") REFERENCES "BeneficiaryFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
