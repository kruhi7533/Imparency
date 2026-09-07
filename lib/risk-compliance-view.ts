/**
 * Builds the per-alert investigation status shown in the Risk & Compliance
 * console — extracted from app/admin/risk-compliance/page.tsx so this linking
 * logic can be tested directly rather than only observed through a rendered
 * server component.
 *
 * The riskReviewId it produces feeds a "View case →" link on each alert. A
 * wrong id here does not error — it silently sends an admin to a case that
 * does not exist, which is worse than not having the link, so this is worth
 * pinning with tests rather than trusting by inspection.
 */

export interface InvestigationLite {
  status: string;
  riskLevel: string | null;
  summary: string | null;
  alertId: string | null;
  triggeredBy: string;
  createdAt: unknown; // ordering only — never compared here, just carried through
}

export interface RiskReviewLite {
  id: string;
  alertIds: string[];
  riskLevel: string;
}

export interface AlertInvestigationStatus {
  status: string;
  riskLevel: string | null;
  summary: string | null;
  riskReviewId: string | null;
}

export function buildInvestigationStatusByAlertId(
  investigations: InvestigationLite[],
  riskReviews: RiskReviewLite[]
): Record<string, AlertInvestigationStatus> {
  const result: Record<string, AlertInvestigationStatus> = {};

  // Investigations must already be newest-first — this only keeps the first
  // (latest) hit per alert, it does not sort.
  for (const inv of investigations) {
    const alertId =
      inv.alertId ??
      (inv.triggeredBy.startsWith("alert:") ? inv.triggeredBy.slice("alert:".length) : null);
    if (alertId && !result[alertId]) {
      result[alertId] = {
        status: inv.status,
        riskLevel: inv.riskLevel,
        summary: inv.summary,
        riskReviewId: null, // filled below — FraudInvestigation does not persist this link
      };
    }
  }

  // RiskReview.alertIds is the one authoritative source for the case link.
  // Every alert it names must end up with a riskReviewId here, whether or not
  // an investigation row already claimed that alertId above.
  for (const review of riskReviews) {
    for (const alertId of review.alertIds ?? []) {
      const existing = result[alertId];
      if (existing) {
        existing.riskReviewId = review.id;
      } else {
        result[alertId] = {
          status: "COMPLETED",
          riskLevel: review.riskLevel,
          summary: null,
          riskReviewId: review.id,
        };
      }
    }
  }

  return result;
}

/**
 * View model for the "Risk & Fraud" section on an NGO's own detail page.
 * Extracted from app/admin/ngos/[id]/page.tsx so the decision — what counts
 * as "nothing to show", and what each open review displays — is testable
 * without rendering a Server Component wired to Prisma.
 *
 * This exists because of a real bug: the section used to check
 * `ngo.riskReviews.filter(open).length` to decide whether to show an
 * empty-state message, but only ever RENDERED `openAlerts`. An NGO with an
 * open RiskReview and zero open alerts — realistic, since a review can be
 * swept in via debounce reuse after its own triggering alert resolved — fell
 * into neither branch cleanly and the section rendered nothing at all. Not
 * even the empty-state text. An active fraud case, invisible on the one page
 * an admin is most likely to be reading while deciding whether to approve
 * that NGO.
 */

export interface RiskReviewFindings {
  reason?: string;
  recommendedAction?: string;
}

export interface NgoRiskReviewLite {
  id: string;
  status: string;
  riskLevel: string;
  createdAt: unknown; // formatted by the caller — this module does not format dates
  findings: unknown;
}

export interface NgoOpenReviewView {
  id: string;
  riskLevel: string;
  createdAt: unknown;
  /** Pre-formatted ("name mismatch"), or null if the finding carried no reason. */
  reasonLabel: string | null;
  /** Pre-formatted, or null if the finding carried no recommendation. */
  recommendedActionLabel: string | null;
  caseHref: string;
}

export interface NgoRiskAndFraudView {
  /** True only when there is nothing at all to show — both lists are empty. */
  isEmpty: boolean;
  openReviews: NgoOpenReviewView[];
}

function formatFindingLabel(value: string | undefined): string | null {
  return value ? value.replace(/_/g, " ") : null;
}

export function buildNgoRiskAndFraudView(
  openAlertsCount: number,
  riskReviews: NgoRiskReviewLite[]
): NgoRiskAndFraudView {
  const openReviews = riskReviews.filter((r) => r.status === "OPEN");

  return {
    isEmpty: openAlertsCount === 0 && openReviews.length === 0,
    openReviews: openReviews.map((r) => {
      const findings = (r.findings ?? null) as RiskReviewFindings | null;
      return {
        id: r.id,
        riskLevel: r.riskLevel,
        createdAt: r.createdAt,
        reasonLabel: formatFindingLabel(findings?.reason),
        recommendedActionLabel: formatFindingLabel(findings?.recommendedAction),
        caseHref: `/admin/risk-compliance?case=${r.id}`,
      };
    }),
  };
}
