import prisma from "@/lib/prisma";

/**
 * Beneficiary feedback, aggregated (NGO-018).
 *
 * Two views over the same rows, and the difference between them is the point:
 *
 *   NGO view    counts of everything captured (including refusals and
 *               withdrawals, so the NGO sees its consent rate), the rating
 *               distribution, and the consented, not-withdrawn comments with
 *               the NGO's own pseudonymous reference.
 *   DONOR view  aggregates only — no references, no free text, no per-person
 *               rows — over consented, not-withdrawn feedback only, and
 *               suppressed below MIN_DONOR_COHORT so a small group cannot be
 *               re-identified from an average. Below the threshold the donor
 *               sees status "INSUFFICIENT_DATA", never a 0 or an invented mean.
 *
 * Withdrawal erases rating and text at the source (withdrawalData in
 * lib/field-evidence.ts); this module additionally ignores any row with
 * withdrawnAt set, so a withdrawn person can never be counted.
 */

export const MIN_DONOR_COHORT = 5;

export interface FeedbackRow {
  projectId: string;
  beneficiaryRef: string | null;
  consentToRecord: boolean;
  withdrawnAt: Date | null;
  rating: number | null;
  feedbackText: string | null;
  capturedAt: Date;
}

const usable = (r: FeedbackRow) => r.consentToRecord && r.withdrawnAt === null;

/** Mean to one decimal, as a string, from integer ratings — no float drift in display. */
function meanOneDecimal(ratings: number[]): string | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((a, b) => a + b, 0);
  const tenths = Math.round((sum * 10) / ratings.length);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

function distribution(ratings: number[]): Record<"1" | "2" | "3" | "4" | "5", number> {
  const d = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const r of ratings) if (r >= 1 && r <= 5) d[String(r) as keyof typeof d]++;
  return d;
}

export function ngoFeedbackSummary(rows: FeedbackRow[], commentLimit = 20) {
  const consented = rows.filter(usable);
  const ratings = consented.map((r) => r.rating).filter((v): v is number => v !== null);
  return {
    captured: rows.length,
    consented: consented.length,
    refused: rows.filter((r) => !r.consentToRecord).length,
    withdrawn: rows.filter((r) => r.withdrawnAt !== null).length,
    rated: ratings.length,
    averageRating: meanOneDecimal(ratings),
    distribution: distribution(ratings),
    comments: consented
      .filter((r) => r.feedbackText)
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .slice(0, commentLimit)
      .map((r) => ({ ref: r.beneficiaryRef, rating: r.rating, text: r.feedbackText as string, capturedAt: r.capturedAt.toISOString() })),
  };
}

export type DonorFeedbackSummary =
  | { status: "AVAILABLE"; respondents: number; rated: number; averageRating: string | null; distribution: Record<string, number> }
  | { status: "INSUFFICIENT_DATA"; reason: string };

export function donorFeedbackSummary(rows: FeedbackRow[]): DonorFeedbackSummary {
  const consented = rows.filter(usable);
  if (consented.length < MIN_DONOR_COHORT) {
    return {
      status: "INSUFFICIENT_DATA",
      reason:
        consented.length === 0
          ? "No consented beneficiary feedback yet."
          : `Fewer than ${MIN_DONOR_COHORT} consented responses — not shown, to protect beneficiaries' privacy.`,
    };
  }
  const ratings = consented.map((r) => r.rating).filter((v): v is number => v !== null);
  return {
    status: "AVAILABLE",
    respondents: consented.length,
    rated: ratings.length,
    averageRating: meanOneDecimal(ratings),
    distribution: distribution(ratings),
  };
}

const FEEDBACK_SELECT = {
  projectId: true,
  beneficiaryRef: true,
  consentToRecord: true,
  withdrawnAt: true,
  rating: true,
  feedbackText: true,
  capturedAt: true,
} as const;

/** NGO view per project, for one organisation. Tenant-scoped by ngoId. */
export async function loadNgoFeedbackByProject(ngoId: string) {
  const rows = await prisma.beneficiaryFeedback.findMany({ where: { ngoId }, select: FEEDBACK_SELECT, take: 5000 });
  const by = new Map<string, FeedbackRow[]>();
  for (const r of rows) by.set(r.projectId, [...(by.get(r.projectId) ?? []), r]);
  return {
    overall: ngoFeedbackSummary(rows),
    byProject: Object.fromEntries(Array.from(by.entries()).map(([projectId, group]) => [projectId, ngoFeedbackSummary(group)])),
  };
}

/** Donor-safe view per project. The select never reads text or references out of the database for this path. */
export async function loadDonorFeedbackForProjects(projectIds: string[]): Promise<Record<string, DonorFeedbackSummary>> {
  if (projectIds.length === 0) return {};
  const rows = await prisma.beneficiaryFeedback.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, consentToRecord: true, withdrawnAt: true, rating: true, capturedAt: true },
    take: 10000,
  });
  const out: Record<string, DonorFeedbackSummary> = {};
  for (const id of projectIds) {
    const group = rows
      .filter((r) => r.projectId === id)
      .map((r) => ({ ...r, beneficiaryRef: null, feedbackText: null }));
    out[id] = donorFeedbackSummary(group);
  }
  return out;
}
