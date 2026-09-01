import { describe, it, expect, vi } from "vitest";

/**
 * The risk engines' weighting, tested without a database.
 *
 * What these pin is not "the numbers are right" — weights are a judgement call
 * and will be tuned. It is the handful of properties that must survive tuning:
 * absence of evidence never reads as safety, volume never beats severity, and
 * ordinary paperwork gaps never manufacture a HIGH.
 */

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { computeNgoRisk, type NgoRiskInputs } from "@/lib/risk-engine/ngo";
import { computeDonorRisk, type DonorRiskInputs } from "@/lib/risk-engine/donor";
import { scoreOpenAlerts } from "@/lib/risk-engine/alerts";
import { bandFor, BAND_THRESHOLD, type RiskScoreResult } from "@/lib/risk-engine/types";
import { routeFor } from "@/lib/risk-engine/router";

/** A fully evidenced, entirely unremarkable NGO. */
function cleanNgo(overrides: Partial<NgoRiskInputs> = {}): NgoRiskInputs {
  return {
    isSuspended: false,
    verificationStatus: "VERIFIED",
    healthScore: 90,
    complianceScore: 100,
    fcraExpired: false,
    openAlerts: [],
    openRiskReviewLevel: null,
    extractedFieldCount: 6,
    fieldsNeedingReview: 0,
    ...overrides,
  };
}

function donor(overrides: Partial<DonorRiskInputs> = {}): DonorRiskInputs {
  return {
    panStatus: "VERIFIED",
    totalDonatedRupees: 5_000,
    successfulDonationCount: 2,
    accountAgeDays: 400,
    openAlerts: [],
    topNgoShare: null,
    ...overrides,
  };
}

describe("bandFor — absence of evidence is not evidence of safety", () => {
  it("bands a zero score with an unknown input as UNKNOWN, not LOW", () => {
    expect(bandFor(0, 1)).toBe("UNKNOWN");
    expect(bandFor(0, 0)).toBe("LOW");
  });

  it("keeps HIGH when the score already earned it, unknowns or not", () => {
    expect(bandFor(BAND_THRESHOLD.high, 3)).toBe("HIGH");
  });
});

describe("NGO risk engine", () => {
  it("scores a clean, fully evidenced NGO as LOW", () => {
    const result = computeNgoRisk(cleanNgo());
    expect(result.band).toBe("LOW");
    expect(result.unknownInputs).toBe(0);
  });

  it("never calls an unanalysed NGO low risk, however clean it otherwise looks", () => {
    const result = computeNgoRisk(cleanNgo({ extractedFieldCount: 0, fieldsNeedingReview: 0 }));
    expect(result.band).toBe("UNKNOWN");
    expect(result.signals.map((s) => s.code)).toContain("NO_DOCUMENT_EVIDENCE");
  });

  it("does not push an NGO with no 12A or 80G anywhere near HIGH", () => {
    // Many legitimate NGOs have neither. Penalising their absence would flood
    // the queue and make it worthless — the same rule the verification triage
    // is built around. Here it costs only the compliance-score weight.
    const withoutBoth = computeNgoRisk(cleanNgo({ complianceScore: 70 }));
    expect(withoutBoth.band).toBe("LOW");
    expect(withoutBoth.score).toBeLessThan(BAND_THRESHOLD.medium);
  });

  it("ranks one open HIGH alert above a pile of LOW ones", () => {
    const oneHigh = computeNgoRisk(
      cleanNgo({ openAlerts: [{ severity: "HIGH", type: "VERIFICATION_DEFECT" }] })
    );
    const manyLow = computeNgoRisk(
      cleanNgo({
        openAlerts: Array.from({ length: 12 }, () => ({ severity: "LOW", type: "NOISE" })),
      })
    );
    expect(oneHigh.score).toBeGreaterThan(manyLow.score);
  });

  it("treats suspension plus an open critical review as HIGH", () => {
    const result = computeNgoRisk(
      cleanNgo({ isSuspended: true, openRiskReviewLevel: "CRITICAL" })
    );
    expect(result.band).toBe("HIGH");
  });

  it("clamps to 100 when everything is wrong at once", () => {
    const result = computeNgoRisk({
      isSuspended: true,
      verificationStatus: "REJECTED",
      healthScore: 0,
      complianceScore: 0,
      fcraExpired: true,
      openAlerts: [
        { severity: "HIGH", type: "A" },
        { severity: "HIGH", type: "B" },
        { severity: "HIGH", type: "C" },
        { severity: "MEDIUM", type: "D" },
      ],
      openRiskReviewLevel: "CRITICAL",
      extractedFieldCount: 0,
      fieldsNeedingReview: 0,
    });
    expect(result.score).toBe(100);
    expect(result.band).toBe("HIGH");
  });
});

describe("donor risk engine", () => {
  it("scores an ordinary verified donor as LOW", () => {
    expect(computeDonorRisk(donor()).band).toBe("LOW");
  });

  it("will not call a material giver low risk when nothing establishes who they are", () => {
    const result = computeDonorRisk(
      donor({ panStatus: "UNVERIFIED", totalDonatedRupees: 250_000 })
    );
    expect(result.band).toBe("UNKNOWN");
    expect(result.signals.map((s) => s.code)).toContain("IDENTITY_UNVERIFIED_AT_VALUE");
  });

  it("does not treat a small unverified donor as unassessable", () => {
    const result = computeDonorRisk(donor({ panStatus: "UNVERIFIED", totalDonatedRupees: 1_000 }));
    expect(result.band).toBe("LOW");
    expect(result.unknownInputs).toBe(0);
  });

  it("distinguishes a rejected PAN from one that was never checked", () => {
    const failed = computeDonorRisk(donor({ panStatus: "FAILED" }));
    const incomplete = computeDonorRisk(donor({ panStatus: "PROVIDER_ERROR" }));
    expect(failed.score).toBeGreaterThan(incomplete.score);
    // A provider outage says nothing about the donor.
    expect(incomplete.band).toBe("LOW");
  });

  it("notes single-NGO concentration without treating loyalty as a finding", () => {
    const concentrated = computeDonorRisk(
      donor({ topNgoShare: 1, successfulDonationCount: 8, totalDonatedRupees: 40_000 })
    );
    expect(concentrated.signals.map((s) => s.code)).toContain("SINGLE_NGO_CONCENTRATION");
    // Present in the ranking, nowhere near an accusation on its own.
    expect(concentrated.band).toBe("LOW");
  });

  it("ignores concentration below the minimum donation count", () => {
    const result = computeDonorRisk(donor({ topNgoShare: 1, successfulDonationCount: 2 }));
    expect(result.signals.map((s) => s.code)).not.toContain("SINGLE_NGO_CONCENTRATION");
  });
});

describe("open-alert scoring", () => {
  it("caps each severity so volume cannot dominate", () => {
    const many = scoreOpenAlerts(
      Array.from({ length: 50 }, () => ({ severity: "MEDIUM", type: "X" }))
    );
    expect(many[0].points).toBe(24);
  });

  it("returns nothing when there are no open alerts", () => {
    expect(scoreOpenAlerts([])).toEqual([]);
  });
});

describe("routing — where the expensive attention goes", () => {
  const scored = (band: RiskScoreResult["band"], score: number): RiskScoreResult => ({
    score,
    band,
    unknownInputs: band === "UNKNOWN" ? 1 : 0,
    signals: [{ code: "X", label: "something", points: score }],
  });

  it("sends a HIGH NGO to the investigator", () => {
    const route = routeFor("NGO", scored("HIGH", 78));
    expect(route.action).toBe("INVESTIGATE");
  });

  it("sends an UNKNOWN NGO to extraction, NOT to the investigator", () => {
    // The whole point: an investigation of an NGO whose documents were never
    // read calls get_document_evidence, gets `analysed: false`, and correctly
    // files nothing — six minutes and ~35k tokens to be told what the score
    // already said. Read the documents first.
    const route = routeFor("NGO", scored("UNKNOWN", 28));
    expect(route.action).toBe("EXTRACT");
  });

  it("does not send a HIGH donor to the investigator, which cannot handle donors", () => {
    const route = routeFor("DONOR", scored("HIGH", 70));
    expect(route.action).toBe("MONITOR");
    expect(route.reason).toContain("only handles NGOs");
  });

  it("spends nothing on MEDIUM or LOW", () => {
    expect(routeFor("NGO", scored("MEDIUM", 30)).action).toBe("MONITOR");
    expect(routeFor("NGO", scored("LOW", 5)).action).toBe("MONITOR");
  });

  it("always gives a reason, whatever it decides", () => {
    for (const band of ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const) {
      expect(routeFor("NGO", scored(band, 40)).reason.length).toBeGreaterThan(0);
    }
  });
});
