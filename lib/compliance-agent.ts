import prisma from "@/lib/prisma";
import { computeCompliance, deriveFcraStatus, hasVerifiedImpactProof } from "@/lib/ngo-compliance";
import { findUnbackedFlags, getComplianceEvidence } from "@/lib/compliance-evidence";

export interface NGOComplianceSummary {
  ngoId: string;
  orgName: string;
  email: string;
  verificationStatus: string;
  complianceScore: number;
  breakdown: {
    pan: number;
    registration: number;
    a12: number;
    eightyG: number;
    impact: number;
  };
  fcraBadge: string;
  fcraExpiryDate: string | null;
  panVerified: boolean;
  registrationVerified: boolean;
  a12Verified: boolean;
  eightyGVerified: boolean;

  /**
   * False when the NGO has no NGOCompliance row at all.
   *
   * Without this, "we have never assessed this organisation" and "we assessed
   * it and nothing is verified" both render as a row of dashes — the same
   * absence-reads-as-answer mistake the UNKNOWN risk band exists to prevent.
   */
  hasComplianceRecord: boolean;
  /**
   * Flags that are set but have no validated field behind them: claims the
   * platform is making publicly and cannot support. Legacy rows from when
   * approval set flags unconditionally. The nightly sweep revokes these, so a
   * non-empty list here means the sweep has not run since they appeared.
   */
  unbackedFlags: string[];
  /** False when nothing has ever been extracted from this NGO's documents. */
  hasExtraction: boolean;
}

/**
 * Fetches compliance summaries for all verified NGOs.
 * Used by the Compliance tab in /admin/risk-compliance.
 */
export async function getAllComplianceSummaries(): Promise<NGOComplianceSummary[]> {
  const profiles = await prisma.nGOProfile.findMany({
    where: { verificationStatus: "VERIFIED", isDeleted: false },
    include: {
      user: { select: { email: true } },
      compliance: true,
    },
    orderBy: { orgName: "asc" },
  });

  const summaries: NGOComplianceSummary[] = [];

  for (const p of profiles) {
    const hasImpact = await hasVerifiedImpactProof(p.id);
    const result = computeCompliance(p.compliance, hasImpact);
    const unbackedFlags = await findUnbackedFlags(p.id);
    const evidence = await getComplianceEvidence(p.id);

    // Derive live FCRA status from expiry date
    const liveStatus =
      p.compliance?.fcraExpiryDate &&
      ["ACTIVE", "EXPIRING_SOON", "EXPIRED"].includes(p.compliance.fcraStatus)
        ? (deriveFcraStatus(p.compliance.fcraExpiryDate) ?? p.compliance.fcraStatus)
        : (p.compliance?.fcraStatus ?? "NONE");

    summaries.push({
      ngoId: p.id,
      orgName: p.orgName,
      email: p.user.email,
      verificationStatus: p.verificationStatus,
      complianceScore: result.score,
      breakdown: result.breakdown,
      fcraBadge: liveStatus as string,
      fcraExpiryDate: p.compliance?.fcraExpiryDate
        ? p.compliance.fcraExpiryDate.toISOString()
        : null,
      panVerified: p.compliance?.panVerified ?? false,
      registrationVerified: p.compliance?.registrationVerified ?? false,
      a12Verified: p.compliance?.a12Verified ?? false,
      eightyGVerified: p.compliance?.eightyGVerified ?? false,
      hasComplianceRecord: p.compliance !== null,
      unbackedFlags,
      hasExtraction: !evidence.noExtraction,
    });
  }

  return summaries;
}
