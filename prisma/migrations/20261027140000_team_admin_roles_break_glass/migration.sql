-- Workstream E: NGO team invites, donor FINANCE role, admin sub-roles, break-glass.
-- Additive only.

ALTER TYPE "TeamRole" ADD VALUE IF NOT EXISTS 'PROGRAM_MANAGER';
ALTER TYPE "DonorTeamRole" ADD VALUE IF NOT EXISTS 'FINANCE';

CREATE TYPE "AdminRole" AS ENUM ('SUPER', 'FINANCE', 'AUDITOR', 'SUPPORT');
CREATE TYPE "TeamInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

ALTER TABLE "User" ADD COLUMN "adminRole" "AdminRole";

ALTER TABLE "TeamInvite"
  ADD COLUMN "tokenHash" TEXT,
  ADD COLUMN "status" "TeamInviteStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "invitedById" TEXT,
  ADD COLUMN "acceptedUserId" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" TEXT,
  ADD COLUMN "lastSentAt" TIMESTAMP(3),
  ADD COLUMN "sendCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "TeamInvite" SET "status" = 'ACCEPTED' WHERE "accepted" = true;
CREATE UNIQUE INDEX "TeamInvite_tokenHash_key" ON "TeamInvite"("tokenHash");

CREATE TABLE "BreakGlassGrant" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "orgType" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    CONSTRAINT "BreakGlassGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BreakGlassGrant_adminId_expiresAt_idx" ON "BreakGlassGrant"("adminId", "expiresAt");
CREATE INDEX "BreakGlassGrant_orgType_orgId_idx" ON "BreakGlassGrant"("orgType", "orgId");
