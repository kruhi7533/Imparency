import { describe, it, expect } from "vitest";
import { buildInvestigationStatusByAlertId, buildNgoRiskAndFraudView } from "@/lib/risk-compliance-view";

/**
 * A wrong riskReviewId here does not throw — it silently sends an admin to a
 * case that does not exist. That failure mode is invisible in a screenshot and
 * only shows up as "the link didn't work," reported by someone else, later.
 * These pin the three ways an alert can end up linked to a case.
 */

describe("buildInvestigationStatusByAlertId", () => {
  it("has no entry for an alert nobody has investigated", () => {
    const result = buildInvestigationStatusByAlertId([], []);
    expect(result["alert_1"]).toBeUndefined();
  });

  it("links an alert to the case its own investigation opened", () => {
    const result = buildInvestigationStatusByAlertId(
      [
        {
          status: "COMPLETED",
          riskLevel: "HIGH",
          summary: "Name mismatch across documents.",
          alertId: "alert_1",
          triggeredBy: "auto",
          createdAt: new Date(),
        },
      ],
      [{ id: "review_1", alertIds: ["alert_1"], riskLevel: "HIGH" }]
    );

    expect(result["alert_1"]).toEqual({
      status: "COMPLETED",
      riskLevel: "HIGH",
      summary: "Name mismatch across documents.",
      riskReviewId: "review_1",
    });
  });

  it("links a CLEAN investigation's alert to a case opened by a DIFFERENT alert on the same NGO", () => {
    // The scenario from today's walkthrough: an alert investigated clean by
    // itself can still belong to an NGO with an open case from an earlier,
    // unrelated alert. The review names both alertIds via debounce reuse.
    const result = buildInvestigationStatusByAlertId(
      [
        {
          status: "COMPLETED",
          riskLevel: null, // this run found nothing
          summary: "Investigated — nothing filed.",
          alertId: "alert_clean",
          triggeredBy: "auto",
          createdAt: new Date(),
        },
      ],
      [{ id: "review_9", alertIds: ["alert_earlier", "alert_clean"], riskLevel: "MEDIUM" }]
    );

    expect(result["alert_clean"].riskReviewId).toBe("review_9");
    // The alert's OWN clean verdict must survive — the case link augments it,
    // it does not overwrite what this specific run found.
    expect(result["alert_clean"].riskLevel).toBeNull();
    expect(result["alert_earlier"].riskReviewId).toBe("review_9");
  });

  it("falls back to the legacy triggeredBy encoding when alertId is null", () => {
    const result = buildInvestigationStatusByAlertId(
      [
        {
          status: "COMPLETED",
          riskLevel: "LOW",
          summary: null,
          alertId: null,
          triggeredBy: "alert:alert_legacy",
          createdAt: new Date(),
        },
      ],
      []
    );

    expect(result["alert_legacy"]).toBeDefined();
    expect(result["alert_legacy"].riskReviewId).toBeNull();
  });

  it("keeps only the newest investigation when the same alert has more than one", () => {
    const result = buildInvestigationStatusByAlertId(
      [
        { status: "COMPLETED", riskLevel: "HIGH", summary: "latest run", alertId: "a1", triggeredBy: "auto", createdAt: new Date() },
        { status: "COMPLETED", riskLevel: "LOW", summary: "earlier run", alertId: "a1", triggeredBy: "auto", createdAt: new Date() },
      ],
      []
    );

    // Caller must pass investigations newest-first; this only takes the first
    // match, it never sorts.
    expect(result["a1"].summary).toBe("latest run");
  });

  it("never links to a review that does not list the alert", () => {
    const result = buildInvestigationStatusByAlertId(
      [
        {
          status: "COMPLETED",
          riskLevel: "HIGH",
          summary: "flagged",
          alertId: "alert_x",
          triggeredBy: "auto",
          createdAt: new Date(),
        },
      ],
      [{ id: "review_unrelated", alertIds: ["alert_y"], riskLevel: "HIGH" }]
    );

    expect(result["alert_x"].riskReviewId).toBeNull();
  });
});

describe("buildNgoRiskAndFraudView", () => {
  const OPEN: any = {
    id: "review_1",
    status: "OPEN",
    riskLevel: "HIGH",
    createdAt: new Date("2026-08-01"),
    findings: { reason: "name_mismatch", recommendedAction: "escalate_to_senior" },
  };

  it("is empty only when there are zero open alerts AND zero open reviews", () => {
    expect(buildNgoRiskAndFraudView(0, []).isEmpty).toBe(true);
    expect(buildNgoRiskAndFraudView(1, []).isEmpty).toBe(false);
    expect(buildNgoRiskAndFraudView(0, [OPEN]).isEmpty).toBe(false);
  });

  it("is NOT empty for an open review with zero open alerts — the exact case the section used to render blank", () => {
    // This is the regression this function exists to prevent: a RiskReview
    // swept in via debounce reuse after its own triggering alert resolved has
    // no open alert of its own, and the old inline check only looked at
    // openAlerts.length.
    const view = buildNgoRiskAndFraudView(0, [OPEN]);
    expect(view.isEmpty).toBe(false);
    expect(view.openReviews).toHaveLength(1);
  });

  it("excludes reviews that are not OPEN", () => {
    const view = buildNgoRiskAndFraudView(0, [{ ...OPEN, status: "CLEARED" }]);
    expect(view.isEmpty).toBe(true);
    expect(view.openReviews).toHaveLength(0);
  });

  it("formats reason and recommendedAction by replacing underscores with spaces", () => {
    const [r] = buildNgoRiskAndFraudView(0, [OPEN]).openReviews;
    expect(r.reasonLabel).toBe("name mismatch");
    expect(r.recommendedActionLabel).toBe("escalate to senior");
  });

  it("returns null labels, not empty strings or 'undefined', when findings carries no reason or recommendation", () => {
    const [r] = buildNgoRiskAndFraudView(0, [{ ...OPEN, findings: {} }]).openReviews;
    expect(r.reasonLabel).toBeNull();
    expect(r.recommendedActionLabel).toBeNull();
  });

  it("tolerates a null findings column rather than throwing", () => {
    const [r] = buildNgoRiskAndFraudView(0, [{ ...OPEN, findings: null }]).openReviews;
    expect(r.reasonLabel).toBeNull();
  });

  it("builds a case link back to the exact review", () => {
    const [r] = buildNgoRiskAndFraudView(0, [OPEN]).openReviews;
    expect(r.caseHref).toBe("/admin/risk-compliance?case=review_1");
  });
});
