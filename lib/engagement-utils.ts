import { DonorPersona, DonorTier, ReEngagementPath } from "@prisma/client";

interface DonorContext {
  persona: DonorPersona | null;
  donationCount: number;
  totalDonated: number;       // in rupees
  volunteerInterest: boolean;
  donorTier: DonorTier;
}

/**
 * Selects the optimal re-engagement CTA path for a donor based on priority rules.
 */
export function selectReEngagementPath(ctx: DonorContext): ReEngagementPath {
  // Priority order:
  // 1. CSR_OFFICER or FOUNDATION with 2+ donations → GRANT_MODE
  if (
    (ctx.persona === "CSR_OFFICER" || ctx.persona === "FOUNDATION") &&
    ctx.donationCount >= 2
  ) {
    return "GRANT_MODE";
  }
  // 2. MAJOR_DONOR tier or totalDonated > 50000 → TIER_UPGRADE
  if (ctx.donorTier === "MAJOR_DONOR" || ctx.totalDonated > 50000) {
    return "TIER_UPGRADE";
  }
  // 3. 3+ donations and not yet COMMITTED → TIER_UPGRADE
  if (ctx.donationCount >= 3 && ctx.donorTier === "STANDARD") {
    return "TIER_UPGRADE";
  }
  // 4. volunteerInterest flag set → VOLUNTEER_ADVISOR
  if (ctx.volunteerInterest) {
    return "VOLUNTEER_ADVISOR";
  }
  // 5. Default → NGO_REFERRAL (works for everyone)
  return "NGO_REFERRAL";
}

/**
 * Computes a donor's tier based on transaction count and cumulative amount.
 */
export function computeDonorTier(
  donationCount: number,
  totalDonated: number
): DonorTier {
  if (totalDonated > 50000) return "MAJOR_DONOR";
  if (donationCount >= 3) return "COMMITTED";
  return "STANDARD";
}
