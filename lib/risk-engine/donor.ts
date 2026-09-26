import prisma from "@/lib/prisma";
import { scoreOpenAlerts, type AlertLike } from "./alerts";
import { finalise, type RiskScoreResult, type RiskSignal } from "./types";

/**
 * The donor risk engine.
 *
 * Separate from the NGO engine on purpose, and its output is never ranked
 * against NGO scores: an NGO at 80 means "this organisation may not be what it
 * claims", a donor at 80 means "this money may not be what it claims".
 * Different evidence, different queue, different action.
 *
 * Deterministic. No model call.
 */

/**
 * Donation value above which unverified identity stops being a formality.
 *
 * Chosen to sit where 80G receipting and donor-identity questions actually
 * start to matter, rather than flagging every small giver as unassessable —
 * a risk queue that contains everybody contains nothing.
 */
export const IDENTITY_MATERIALITY_RUPEES = 50_000;

const NEW_ACCOUNT_DAYS = 30;
const NEW_ACCOUNT_VOLUME_RUPEES = 100_000;

/** Share of a donor's giving going to one NGO before it reads as concentration. */
const CONCENTRATION_SHARE = 0.9;
const CONCENTRATION_MIN_DONATIONS = 5;

export interface DonorRiskInputs {
  panStatus: "UNVERIFIED" | "VERIFIED" | "FAILED" | "PROVIDER_ERROR";
  /** Total value of SUCCESS donations, in rupees. */
  totalDonatedRupees: number;
  successfulDonationCount: number;
  accountAgeDays: number;
  openAlerts: AlertLike[];
  /**
   * Largest share of this donor's giving that went to any single NGO, 0..1.
   * Null when they have not given enough for the ratio to mean anything.
   */
  topNgoShare: number | null;
}

export function computeDonorRisk(input: DonorRiskInputs): RiskScoreResult {
  const signals: RiskSignal[] = [];
  let unknownInputs = 0;

  const identityMatters = input.totalDonatedRupees >= IDENTITY_MATERIALITY_RUPEES;

  if (input.panStatus === "FAILED") {
    signals.push({
      code: "PAN_FAILED",
      label: "PAN verification was rejected by the provider",
      points: 30,
    });
  } else if (input.panStatus === "UNVERIFIED") {
    if (identityMatters) {
      // The donor-side equivalent of an NGO whose documents were never read:
      // meaningful money has moved and nothing establishes who sent it. Not an
      // accusation — an admission that we cannot say, which must not be
      // rendered as low risk.
      unknownInputs += 1;
      signals.push({
        code: "IDENTITY_UNVERIFIED_AT_VALUE",
        label: "Identity never verified, despite material giving",
        points: 12,
        detail: `₹${input.totalDonatedRupees.toLocaleString("en-IN")} donated with no verified PAN.`,
      });
    } else {
      signals.push({
        code: "PAN_UNVERIFIED",
        label: "PAN not verified",
        points: 4,
      });
    }
  } else if (input.panStatus === "PROVIDER_ERROR") {
    // The provider failed open — this says nothing about the donor, only that
    // the check never completed. Worth re-running, not worth much score.
    signals.push({
      code: "PAN_CHECK_INCOMPLETE",
      label: "PAN check never completed (provider error)",
      points: 3,
    });
  }

  signals.push(...scoreOpenAlerts(input.openAlerts));

  if (
    input.accountAgeDays <= NEW_ACCOUNT_DAYS &&
    input.totalDonatedRupees >= NEW_ACCOUNT_VOLUME_RUPEES
  ) {
    signals.push({
      code: "NEW_ACCOUNT_HIGH_VOLUME",
      label: "Large giving from a very new account",
      points: 10,
      detail: `₹${input.totalDonatedRupees.toLocaleString("en-IN")} in ${input.accountAgeDays} day(s).`,
    });
  }

  if (
    input.topNgoShare !== null &&
    input.topNgoShare >= CONCENTRATION_SHARE &&
    input.successfulDonationCount >= CONCENTRATION_MIN_DONATIONS
  ) {
    // Not suspicious on its own — loyal donors exist, and this must never be
    // treated as a finding by itself. It is here because it is the donor-side
    // half of a pattern the relationship layer will read: money that only ever
    // moves between one pair of parties.
    signals.push({
      code: "SINGLE_NGO_CONCENTRATION",
      label: "Gives almost exclusively to one NGO",
      points: 8,
      detail: `${Math.round(input.topNgoShare * 100)}% of ${input.successfulDonationCount} donations.`,
    });
  }

  return finalise(signals, unknownInputs);
}

export async function gatherDonorRisk(donorId: string): Promise<DonorRiskInputs | null> {
  const donor = await prisma.user.findUnique({
    where: { id: donorId },
    select: { id: true, panStatus: true, createdAt: true },
  });
  if (!donor) return null;

  const [openAlerts, donations] = await Promise.all([
    prisma.fraudAlert.findMany({
      where: { resolved: false, entityId: donorId },
      select: { severity: true, type: true },
    }),
    prisma.donation.findMany({
      where: { donorId, status: "SUCCESS" },
      select: { amount: true, project: { select: { ngoId: true } } },
    }),
  ]);

  // Aggregated in memory rather than with a groupBy: the join to reach an NGO
  // id runs through Project, and the row count here is one donor's donations,
  // not the table.
  const byNgo = new Map<string, number>();
  let total = 0;
  for (const d of donations) {
    const amount = Number(d.amount);
    total += amount;
    byNgo.set(d.project.ngoId, (byNgo.get(d.project.ngoId) ?? 0) + amount);
  }

  const topNgoTotal = Math.max(0, ...Array.from(byNgo.values()));
  const topNgoShare = total > 0 ? topNgoTotal / total : null;

  return {
    panStatus: donor.panStatus,
    totalDonatedRupees: total,
    successfulDonationCount: donations.length,
    accountAgeDays: Math.floor((Date.now() - donor.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    openAlerts,
    topNgoShare,
  };
}

export async function scoreDonor(donorId: string): Promise<RiskScoreResult | null> {
  const inputs = await gatherDonorRisk(donorId);
  return inputs === null ? null : computeDonorRisk(inputs);
}
