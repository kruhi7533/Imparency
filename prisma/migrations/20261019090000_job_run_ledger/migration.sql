-- Job run ledger (Week 9 SPEC-2).
--
-- Nine cron routes existed with no record that any of them ever ran, so a job
-- that was never scheduled and one that had been failing nightly for a month
-- looked identical. This table is what /admin/ops renders.
--
-- Hand-written and purely additive, per CLAUDE.md: this database is shared with
-- other branches, so a generated `prisma migrate diff` would propose DROPping
-- objects this schema does not know about.
--
-- EVERY DEFAULT HERE MUST MATCH schema.prisma EXACTLY. Four columns elsewhere
-- in this repo were created with a database default the Prisma model never
-- declared (MilestoneProof.contentHashes, Grievance.updatedAt,
-- MetricDefinition.updatedAt, OutcomeClaim.updatedAt), and CI's "check schema
-- and migrations agree" gate failed on all four. A convenience default added
-- here that the model does not declare would reintroduce exactly that.
--   id            -> @default(uuid()) is generated client-side: NO db default.
--   status        -> @default(RUNNING)
--   startedAt     -> @default(now())
-- Everything else is nullable with no default.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobRun" (
  "id"             TEXT NOT NULL,
  "job"            TEXT NOT NULL,
  "status"         "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  "durationMs"     INTEGER,
  "itemsProcessed" INTEGER,
  "trigger"        TEXT NOT NULL,
  "correlationId"  TEXT,
  "errorName"      TEXT,
  "errorMessage"   TEXT,
  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "JobRun_job_startedAt_idx"    ON "JobRun"("job", "startedAt");
CREATE INDEX IF NOT EXISTS "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt");

-- No foreign keys: `job` references a registry that lives in code
-- (lib/job-registry.ts), not a table. A job removed from the registry keeps its
-- history here, which is the point of a ledger.
