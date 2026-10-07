-- Week 7 grievance redress: a complaint about a funded organisation, and the
-- record of what was done about it. Closes a gap the privacy policy has
-- already promised.
--
-- Additive and re-runnable (IF NOT EXISTS / DO blocks for the enums) so it can
-- be applied by hand to the shared Neon dev database, which carries tables
-- this schema does not know about — see CLAUDE.md on why `migrate dev` is not
-- used here.

DO $$ BEGIN
    CREATE TYPE "GrievanceCategory" AS ENUM ('FUND_MISUSE', 'SERVICE_FAILURE', 'SAFEGUARDING', 'DATA_PRIVACY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "GrievanceStatus" AS ENUM ('OPEN', 'TRIAGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "GrievanceSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Grievance" (
    "id" TEXT NOT NULL,
    "ngoId" TEXT NOT NULL,
    "projectId" TEXT,
    -- NOT NULL: signed-in filing only. Opening anonymous intake later is a
    -- deliberate migration, which is the point of not making it nullable now.
    "reporterId" TEXT NOT NULL,
    "category" "GrievanceCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "GrievanceStatus" NOT NULL DEFAULT 'OPEN',
    -- Nullable, not defaulted: "not yet judged" must be distinguishable from
    -- "judged, and it is LOW".
    "severity" "GrievanceSeverity",
    "triagedById" TEXT,
    "triagedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grievance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Grievance_status_idx" ON "Grievance"("status");
CREATE INDEX IF NOT EXISTS "Grievance_ngoId_status_idx" ON "Grievance"("ngoId", "status");
CREATE INDEX IF NOT EXISTS "Grievance_reporterId_idx" ON "Grievance"("reporterId");

DO $$ BEGIN
    ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_ngoId_fkey"
        FOREIGN KEY ("ngoId") REFERENCES "NGOProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_reporterId_fkey"
        FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_triagedById_fkey"
        FOREIGN KEY ("triagedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Grievance" ADD CONSTRAINT "Grievance_resolvedById_fkey"
        FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
