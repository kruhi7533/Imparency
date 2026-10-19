-- Donor organisation team members and invites. Additive and idempotent.
DO $$ BEGIN
  CREATE TYPE "DonorTeamRole" AS ENUM ('ADMIN', 'APPROVER', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DonorTeamMember" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "DonorTeamRole" NOT NULL DEFAULT 'VIEWER',
  "invitedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DonorTeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DonorTeamMember_userId_key" ON "DonorTeamMember"("userId");
CREATE INDEX IF NOT EXISTS "DonorTeamMember_accountId_idx" ON "DonorTeamMember"("accountId");

CREATE TABLE IF NOT EXISTS "DonorTeamInvite" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "DonorTeamRole" NOT NULL DEFAULT 'VIEWER',
  "token" TEXT NOT NULL,
  "accepted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DonorTeamInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DonorTeamInvite_token_key" ON "DonorTeamInvite"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "DonorTeamInvite_email_accountId_key" ON "DonorTeamInvite"("email", "accountId");
