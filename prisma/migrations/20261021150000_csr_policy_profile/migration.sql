-- CSR policy summary and focus areas on the donor CSR profile. Additive.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "csrPolicySummary" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "csrFocusAreas" TEXT[] DEFAULT ARRAY[]::TEXT[];
