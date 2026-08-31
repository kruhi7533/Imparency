import prisma from "@/lib/prisma";
import { computeCompliance, deriveFcraStatus, hasVerifiedImpactProof } from "@/lib/ngo-compliance";
import { scoreOpenAlerts, type AlertLike } from "./alerts";
import { finalise, type RiskScoreResult, type RiskSignal } from "./types";

/**
 * The NGO risk engine.
 *
 * Answers one question the console currently cannot: "how risky is this
 * organisation, overall?" Today that judgement is spread across a compliance
 * score, a health score, an alert queue and an extraction verdict, and nobody —
 * including an admin looking straight at the NGO — can combine them by eye.
 *
 * Deterministic. No model call. See ./types for why.
 */

export interface NgoRiskInputs {
  isSuspended: boolean;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
  /** 0..100, higher is BETTER. Null when it has never been calculated. */
  healthScore: number | null;
  /** 0..100, higher is BETTER — from computeCompliance. */
  complianceScore: number;
  /** Live FCRA status after expiry is taken into account. */
  fcraExpired: boolean;
  openAlerts: AlertLike[];
  /** Worst riskLevel among OPEN RiskReviews, or null if none are open. */
  openRiskReviewLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  /** How many ExtractedField rows exist at all. Zero means never analysed. */
  extractedFieldCount: number;
  /** How many of those are still NEEDS_REVIEW. */
  fieldsNeedingReview: number;
}

const RISK_REVIEW_POINTS = { CRITICAL: 35, HIGH: 30, MEDIUM: 15, LOW: 5 } as const;

/**
 * Pure: inputs in, score out. Kept pure for the same reason computeCompliance
 * is — the weighting is the part worth testing, and it should be testable
 * without a database.
 */
export function computeNgoRisk(input: NgoRiskInputs): RiskScoreResult {
  const signals: RiskSignal[] = [];
  let unknownInputs = 0;

  if (input.isSuspended) {
    signals.push({
      code: "SUSPENDED",
      label: "Currently suspended",
      points: 40,
    });
  }

  if (input.verificationStatus === "REJECTED") {
    signals.push({
      code: "VERIFICATION_REJECTED",
      label: "Verification was rejected",
      points: 25,
    });
  }

  if (input.openRiskReviewLevel) {
    signals.push({
      code: "OPEN_RISK_REVIEW",
      label: `Open ${input.openRiskReviewLevel} risk review`,
      points: RISK_REVIEW_POINTS[input.openRiskReviewLevel],
    });
  }

  signals.push(...scoreOpenAlerts(input.openAlerts));

  // Compliance and health are "higher is better", so they invert into risk.
  // Deliberately light weights: a low compliance score usually means paperwork
  // an NGO has not got round to, not wrongdoing. It nudges the ranking; it
  // cannot by itself put an organisation in the HIGH band.
  const compliancePoints = Math.round(((100 - input.complianceScore) / 100) * 15);
  if (compliancePoints > 0) {
    signals.push({
      code: "LOW_COMPLIANCE",
      label: `Compliance score ${input.complianceScore}/100`,
      points: compliancePoints,
    });
  }

  if (input.healthScore === null) {
    // Not a critical unknown — a brand-new NGO with no activity has no health
    // score and that is entirely normal. Worth a nudge, not a band change.
    signals.push({
      code: "NO_HEALTH_SCORE",
      label: "No health score calculated yet",
      points: 3,
    });
  } else {
    const healthPoints = Math.round(((100 - input.healthScore) / 100) * 10);
    if (healthPoints > 0) {
      signals.push({
        code: "LOW_HEALTH",
        label: `Health score ${Math.round(input.healthScore)}/100`,
        points: healthPoints,
      });
    }
  }

  if (input.fcraExpired) {
    signals.push({
      code: "FCRA_EXPIRED",
      label: "FCRA certificate has expired",
      points: 8,
    });
  }

  // The one input whose absence is disqualifying. An NGO whose documents have
  // never been read cannot be called low risk on any evidence, so it is counted
  // as an unknown and banded UNKNOWN — never LOW. Same rule the document review
  // queue already follows: "Not analysed" is red, not green.
  if (input.extractedFieldCount === 0) {
    unknownInputs += 1;
    signals.push({
      code: "NO_DOCUMENT_EVIDENCE",
      label: "Registration documents have never been analysed",
      points: 10,
      detail: "Not evidence of a problem — evidence that nobody has looked.",
    });
  } else if (input.fieldsNeedingReview > 0) {
    signals.push({
      code: "FIELDS_NEED_REVIEW",
      label: `${input.fieldsNeedingReview} extracted field(s) still need review`,
      points: Math.min(input.fieldsNeedingReview * 4, 12),
    });
  }

  return finalise(signals, unknownInputs);
}

/**
 * Gather one NGO's inputs and score it.
 *
 * Alerts are looked up across the NGO's own id AND its project and milestone
 * ids, because FraudAlert.entityType "NGO" does not guarantee entityId is an
 * NGO id — several checks in lib/risk-agent.ts file a milestone or project id
 * under that type (see lib/fraud-investigator/resolve-ngo.ts, which solves the
 * same mismatch in the other direction). Scoring only the direct id would
 * silently miss the proof-score and deadline alerts entirely, which are exactly
 * the ones a risk score exists to surface.
 */
export async function gatherNgoRisk(ngoId: string): Promise<NgoRiskInputs | null> {
  const ngo = await prisma.nGOProfile.findUnique({
    where: { id: ngoId },
    select: {
      id: true,
      isSuspended: true,
      verificationStatus: true,
      healthScore: true,
      compliance: {
        select: {
          panVerified: true,
          registrationVerified: true,
          a12Verified: true,
          eightyGVerified: true,
          fcraStatus: true,
          fcraExpiryDate: true,
        },
      },
      projects: { select: { id: true, milestones: { select: { id: true } } } },
    },
  });
  if (!ngo) return null;

  const entityIds = [
    ngo.id,
    ...ngo.projects.map((p) => p.id),
    ...ngo.projects.flatMap((p) => p.milestones.map((m) => m.id)),
  ];

  const [openAlerts, openReview, extractedFieldCount, fieldsNeedingReview, impactProof] =
    await Promise.all([
      prisma.fraudAlert.findMany({
        where: { resolved: false, entityId: { in: entityIds } },
        select: { severity: true, type: true },
      }),
      prisma.riskReview.findFirst({
        where: { ngoId, status: "OPEN" },
        orderBy: { createdAt: "desc" },
        select: { riskLevel: true },
      }),
      prisma.extractedField.count({ where: { ngoId } }),
      prisma.extractedField.count({ where: { ngoId, status: "NEEDS_REVIEW" } }),
      // Reuse the compliance module's own definition of a verified proof rather
      // than writing a second one here — the two drifting apart would mean the
      // risk score and the compliance score disagreed about the same NGO.
      hasVerifiedImpactProof(ngoId),
    ]);

  const { score: complianceScore } = computeCompliance(ngo.compliance, impactProof);

  // The stored fcraStatus can be stale between cron runs; derive the live one
  // the same way the public profile does rather than trusting the column.
  const liveFcra =
    deriveFcraStatus(ngo.compliance?.fcraExpiryDate) ?? ngo.compliance?.fcraStatus ?? "NONE";

  return {
    isSuspended: ngo.isSuspended,
    verificationStatus: ngo.verificationStatus,
    healthScore: ngo.healthScore === null ? null : Number(ngo.healthScore),
    complianceScore,
    fcraExpired: liveFcra === "EXPIRED",
    openAlerts,
    openRiskReviewLevel: (openReview?.riskLevel as NgoRiskInputs["openRiskReviewLevel"]) ?? null,
    extractedFieldCount,
    fieldsNeedingReview,
  };
}

export async function scoreNgo(ngoId: string): Promise<RiskScoreResult | null> {
  const inputs = await gatherNgoRisk(ngoId);
  return inputs === null ? null : computeNgoRisk(inputs);
}
