import prisma from "@/lib/prisma";
import { FCRAStatus, NGOCompliance } from "@prisma/client";

/**
 * Compliance scoring (separate from the operational healthScore).
 *
 * IMPORTANT: the score is DERIVED ON READ — never stored. Storing it would let it
 * drift out of sync the moment an FCRA certificate expires (the cron flips the
 * status, but a stored score would stay stale). The breakdown drifts for the same
 * reason, so neither is persisted. This pure function is the single source of truth.
 */

// FCRA is excluded from the base score — it's only required for NGOs receiving
// foreign donations, so penalising its absence would be unfair to domestic NGOs.
// It is displayed as a separate badge on the public profile.
export const COMPLIANCE_WEIGHTS = {
  pan: 25,
  registration: 25,
  a12: 10,
  eightyG: 20,
  impact: 20,
} as const;

export interface ComplianceBreakdown {
  pan: number;
  registration: number;
  a12: number;
  eightyG: number;
  impact: number;
}

export interface ComplianceResult {
  score: number; // 0..80 base; FCRA shown separately as a badge
  breakdown: ComplianceBreakdown;
  fcraBadge: FCRAStatus; // caller uses this to render the FCRA badge
}

/**
 * Pure: compute the compliance score + breakdown from a compliance record and
 * whether the NGO has at least one verified impact proof. No DB writes.
 */
export function computeCompliance(
  compliance: Pick<
    NGOCompliance,
    | "panVerified"
    | "registrationVerified"
    | "a12Verified"
    | "eightyGVerified"
    | "fcraStatus"
  > | null,
  hasImpactProof: boolean
): ComplianceResult {
  const breakdown: ComplianceBreakdown = {
    pan: compliance?.panVerified ? COMPLIANCE_WEIGHTS.pan : 0,
    registration: compliance?.registrationVerified ? COMPLIANCE_WEIGHTS.registration : 0,
    a12: compliance?.a12Verified ? COMPLIANCE_WEIGHTS.a12 : 0,
    eightyG: compliance?.eightyGVerified ? COMPLIANCE_WEIGHTS.eightyG : 0,
    impact: hasImpactProof ? COMPLIANCE_WEIGHTS.impact : 0,
  };

  const score =
    breakdown.pan +
    breakdown.registration +
    breakdown.a12 +
    breakdown.eightyG +
    breakdown.impact;

  return { score, breakdown, fcraBadge: compliance?.fcraStatus ?? "NONE" };
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Pure: derive the live FCRA status from the expiry date for an approved
 * certificate. Returns null if there's no expiry to reason about (caller keeps
 * the current status, e.g. PENDING/REJECTED/NONE).
 */
export function deriveFcraStatus(expiryDate: Date | null | undefined): FCRAStatus | null {
  if (!expiryDate) return null;

  const now = Date.now();
  const expiry = new Date(expiryDate).getTime();

  if (expiry <= now) return "EXPIRED";
  if (expiry - now <= NINETY_DAYS_MS) return "EXPIRING_SOON";
  return "ACTIVE";
}

/**
 * Append an entry to the compliance audit trail (drives the public Trust Timeline).
 * Best-effort: never throws — an audit-log failure must not break the caller.
 */
export async function logComplianceEvent(
  complianceId: string,
  event: string,
  detail?: string,
  actorId?: string | null
): Promise<void> {
  try {
    await prisma.complianceAuditLog.create({
      data: { complianceId, event, detail: detail ?? null, actorId: actorId ?? null },
    });
  } catch (err) {
    console.error(`Failed to write compliance audit log (${event}):`, err);
  }
}

/**
 * Whether an NGO has at least one verified/approved milestone proof, used for the
 * "Impact proofs" compliance factor.
 */
export async function hasVerifiedImpactProof(ngoId: string): Promise<boolean> {
  const count = await prisma.milestoneProof.count({
    where: {
      milestone: {
        project: { ngoId },
        status: { in: ["VERIFIED", "COMPLETED"] },
      },
    },
  });
  return count > 0;
}
