import { describe, it, expect, vi } from "vitest";
import {
  summarisePortfolio,
  registryHygiene,
  claimDisplay,
  sharePercent,
  isBacked,
  isDefective,
  toMinorUnits,
  fromMinorUnits,
  ASSERTED_STATUSES,
  type QualityClaimRow,
} from "@/lib/impact-quality";
import type { TriageFinding, TriageResult } from "@/lib/outcome-triage";

// lib/outcome-evidence.ts imports the client at module scope for its query
// helpers; `alreadyCountedFrom` and `incidentsFromIndex` are pure and never
// touch it, but the import still has to resolve.
vi.mock("@/lib/prisma", () => ({
  default: { outcomeClaimEvidence: { findMany: vi.fn(async () => []) } },
}));

import { alreadyCountedFrom, incidentsFromIndex } from "@/lib/outcome-evidence";

/**
 * The portfolio quality dashboard's arithmetic (Week 8 SPEC-4).
 *
 * What is worth pinning here is not that the sums add up — it is the handful of
 * decisions where the obvious implementation is wrong in a way that would be
 * invisible on screen:
 *
 *  - an empty portfolio must read "—", never "0%", which would say that
 *    everything the platform publishes is unsupported;
 *  - a REJECTED claim must leave the denominator, or the backed share would
 *    FALL every time the platform correctly caught something;
 *  - an approved claim whose evidence has since collapsed must resurface;
 *  - and an unbacked number must render as "unverified", never as 0.
 */

const CLEAN: TriageResult = { verdict: "CLEAN", findings: [] };

const finding = (
  code: TriageFinding["code"],
  severity: TriageFinding["severity"]
): TriageFinding => ({ code, severity, message: `${code} fired` });

const blocked = (code: TriageFinding["code"] = "NO_EVIDENCE_CITED"): TriageResult => ({
  verdict: "BLOCKED",
  findings: [finding(code, "BLOCK")],
});

const needsReview = (code: TriageFinding["code"] = "DOUBLE_COUNTED"): TriageResult => ({
  verdict: "NEEDS_REVIEW",
  findings: [finding(code, "HIGH")],
});

const mediumOnly: TriageResult = {
  verdict: "NEEDS_REVIEW",
  findings: [finding("PERIOD_OUTSIDE_EVIDENCE", "MEDIUM")],
};

function row(over: Partial<QualityClaimRow> = {}): QualityClaimRow {
  return {
    id: "c1",
    ngoId: "ngo1",
    orgName: "Asha Trust",
    metricCode: "IB-TRAINED-001",
    metricName: "Individuals trained",
    unit: "COUNT_PEOPLE",
    aggregatable: true,
    status: "APPROVED",
    value: "100.00",
    submittedAt: new Date("2026-10-01T00:00:00Z"),
    triage: CLEAN,
    ...over,
  };
}

describe("exact decimal arithmetic", () => {
  it("round-trips a two-decimal value without touching a float", () => {
    for (const v of ["0.00", "1.00", "0.01", "120.50", "99999999999999.99"]) {
      expect(fromMinorUnits(toMinorUnits(v))).toBe(v);
    }
  });

  it("sums values that would drift through floating point", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754. This is the whole reason value is Decimal.
    const sum = toMinorUnits("0.10") + toMinorUnits("0.20");
    expect(fromMinorUnits(sum)).toBe("0.30");
  });

  it("tolerates a missing or short fractional part", () => {
    expect(fromMinorUnits(toMinorUnits("40"))).toBe("40.00");
    expect(fromMinorUnits(toMinorUnits("40.5"))).toBe("40.50");
  });
});

describe("what counts as backed", () => {
  it("requires BOTH an approval and findings that still hold", () => {
    expect(isBacked(row({ status: "APPROVED", triage: CLEAN }))).toBe(true);
    // Approved over a HIGH finding is a deliberate override, still backed.
    expect(isBacked(row({ status: "APPROVED", triage: needsReview() }))).toBe(true);
    // Approved, but the evidence has since collapsed.
    expect(isBacked(row({ status: "APPROVED", triage: blocked() }))).toBe(false);
    // Clean checks but nobody has approved it.
    expect(isBacked(row({ status: "SUBMITTED", triage: CLEAN }))).toBe(false);
  });

  it("never treats an untriaged claim as backed", () => {
    expect(isBacked(row({ status: "APPROVED", triage: null }))).toBe(false);
  });

  it("counts BLOCK and HIGH as defects but not MEDIUM", () => {
    expect(isDefective(row({ triage: blocked() }))).toBe(true);
    expect(isDefective(row({ triage: needsReview() }))).toBe(true);
    // A question to ask is not an accusation — the 12A rule, applied again.
    expect(isDefective(row({ triage: mediumOnly }))).toBe(false);
    expect(isDefective(row({ triage: CLEAN }))).toBe(false);
  });
});

describe("the asserted universe", () => {
  it("is exactly SUBMITTED, NEEDS_EVIDENCE and APPROVED", () => {
    expect([...ASSERTED_STATUSES].sort()).toEqual([
      "APPROVED",
      "NEEDS_EVIDENCE",
      "SUBMITTED",
    ]);
  });

  it("excludes DRAFT, REJECTED and WITHDRAWN from every figure", () => {
    const p = summarisePortfolio([
      row({ id: "a", status: "APPROVED", triage: CLEAN }),
      row({ id: "b", status: "DRAFT", triage: blocked() }),
      row({ id: "c", status: "REJECTED", triage: blocked() }),
      row({ id: "d", status: "WITHDRAWN", triage: blocked() }),
    ]);
    expect(p.assertedCount).toBe(1);
    expect(p.backedCount).toBe(1);
    expect(p.backedShare).toBe(1);
    // The important half: catching something must not make the platform look
    // worse. Three blocked-but-closed claims leave the share at 100%.
    expect(p.blockedCount).toBe(0);
  });
});

describe("the headline share", () => {
  it("is null on an empty portfolio, never 0", () => {
    const p = summarisePortfolio([]);
    expect(p.backedShare).toBeNull();
    // 0 would render as "0%" and say every published number is unsupported.
    expect(sharePercent(p.backedShare)).toBe("—");
  });

  it("is count-based, so one huge metric cannot swamp the portfolio", () => {
    // 400,000 unbacked meals against 50 backed people trained. A value-weighted
    // share would read ~0%; the honest answer is "one of two numbers is backed".
    const p = summarisePortfolio([
      row({
        id: "meals",
        metricCode: "IB-MEALS-001",
        unit: "COUNT_ITEMS",
        value: "400000.00",
        status: "SUBMITTED",
        triage: blocked(),
      }),
      row({ id: "trained", value: "50.00", status: "APPROVED", triage: CLEAN }),
    ]);
    expect(p.backedShare).toBe(0.5);
    expect(sharePercent(p.backedShare)).toBe("50%");
  });
});

describe("retraction candidates", () => {
  it("surfaces an approved claim whose evidence no longer supports it", () => {
    const p = summarisePortfolio([
      row({ id: "gone", status: "APPROVED", triage: blocked("EVIDENCE_NOT_APPROVED") }),
      row({ id: "fine", status: "APPROVED", triage: CLEAN }),
    ]);
    expect(p.retractionCandidates).toHaveLength(1);
    expect(p.retractionCandidates[0]).toMatchObject({
      claimId: "gone",
      metricCode: "IB-TRAINED-001",
      findingCodes: ["EVIDENCE_NOT_APPROVED"],
    });
  });

  it("does not list a blocked claim that was never approved", () => {
    // It is in the review queue, not a published figure needing withdrawal.
    const p = summarisePortfolio([row({ id: "s", status: "SUBMITTED", triage: blocked() })]);
    expect(p.retractionCandidates).toEqual([]);
    expect(p.blockedCount).toBe(1);
  });

  it("carries only BLOCK codes, not the HIGH ones alongside them", () => {
    const p = summarisePortfolio([
      row({
        id: "mixed",
        status: "APPROVED",
        triage: {
          verdict: "BLOCKED",
          findings: [
            finding("CONSENT_MISSING", "HIGH"),
            finding("EVIDENCE_NOT_APPROVED", "BLOCK"),
          ],
        },
      }),
    ]);
    expect(p.retractionCandidates[0].findingCodes).toEqual(["EVIDENCE_NOT_APPROVED"]);
  });
});

describe("per-metric roll-up", () => {
  it("sums values exactly and reports both shares", () => {
    const p = summarisePortfolio([
      row({ id: "a", value: "60.50", status: "APPROVED", triage: CLEAN }),
      row({ id: "b", value: "39.50", status: "SUBMITTED", triage: blocked() }),
    ]);
    const m = p.byMetric.find((x) => x.metricCode === "IB-TRAINED-001")!;
    expect(m.assertedValue).toBe("100.00");
    expect(m.backedValue).toBe("60.50");
    expect(m.valueShare).toBeCloseTo(0.605, 6);
    expect(m.countShare).toBe(0.5);
  });

  it("refuses to sum a metric the registry marks not aggregatable", () => {
    const p = summarisePortfolio([
      row({ id: "a", metricCode: "IB-RATE-001", unit: "PERCENTAGE", aggregatable: false, value: "80.00" }),
      row({ id: "b", metricCode: "IB-RATE-001", unit: "PERCENTAGE", aggregatable: false, value: "90.00" }),
    ]);
    const m = p.byMetric.find((x) => x.metricCode === "IB-RATE-001")!;
    // Adding two percentages to 170 would be a fabricated number.
    expect(m.assertedValue).toBeNull();
    expect(m.backedValue).toBeNull();
    expect(m.valueShare).toBeNull();
    // The claim share still means something and is still reported.
    expect(m.countShare).toBe(1);
    expect(p.nonAggregatableExcluded).toBe(2);
  });

  it("puts the worst-backed metric first", () => {
    const p = summarisePortfolio([
      row({ id: "a", metricCode: "GOOD", status: "APPROVED", triage: CLEAN }),
      row({ id: "b", metricCode: "BAD", status: "SUBMITTED", triage: blocked() }),
    ]);
    expect(p.byMetric.map((m) => m.metricCode)).toEqual(["BAD", "GOOD"]);
  });

  it("does not divide by zero when a metric's asserted value is 0", () => {
    const p = summarisePortfolio([row({ value: "0.00", status: "SUBMITTED", triage: blocked() })]);
    expect(p.byMetric[0].valueShare).toBeNull();
    expect(p.byMetric[0].countShare).toBe(0);
  });
});

describe("per-organisation rate", () => {
  it("ranks on rate but breaks ties on volume", () => {
    const p = summarisePortfolio([
      // One of one defective: rate 1.0, volume 1.
      row({ id: "a", ngoId: "small", orgName: "Small Trust", status: "SUBMITTED", triage: blocked() }),
      // Two of two defective: rate 1.0, volume 2 — the bigger problem.
      row({ id: "b", ngoId: "big", orgName: "Big Trust", status: "SUBMITTED", triage: blocked() }),
      row({ id: "c", ngoId: "big", orgName: "Big Trust", status: "SUBMITTED", triage: needsReview() }),
    ]);
    expect(p.byOrg.map((o) => o.ngoId)).toEqual(["big", "small"]);
    expect(p.byOrg[0]).toMatchObject({ assertedCount: 2, defectiveCount: 2, rate: 1 });
  });

  it("leaves an organisation with only MEDIUM findings at a zero rate", () => {
    const p = summarisePortfolio([row({ ngoId: "ngo1", triage: mediumOnly })]);
    expect(p.byOrg[0].rate).toBe(0);
  });
});

describe("registry hygiene", () => {
  const metrics = [
    { code: "ACTIVE-USED", status: "ACTIVE" as const, requiredEvidence: ["FIELD_PHOTO" as const] },
    { code: "ACTIVE-UNUSED", status: "ACTIVE" as const, requiredEvidence: ["FIELD_PHOTO" as const] },
    { code: "DRAFT-USED", status: "DRAFT" as const, requiredEvidence: [] },
    { code: "DEPRECATED-UNUSED", status: "DEPRECATED" as const, requiredEvidence: ["FIELD_PHOTO" as const] },
  ];

  it("separates unused published metrics from closed metrics being claimed", () => {
    const h = registryHygiene(metrics, new Set(["ACTIVE-USED", "DRAFT-USED"]));
    expect(h.activeNeverClaimed).toEqual(["ACTIVE-UNUSED"]);
    expect(h.closedBeingClaimed).toEqual(["DRAFT-USED"]);
  });

  it("reports no ACTIVE metric without an evidence rule — the count that must stay 0", () => {
    // A DRAFT metric is allowed an empty rule; only ACTIVE is forbidden one,
    // because that is the state a claim can be made against.
    expect(registryHygiene(metrics, new Set()).activeWithoutEvidenceRule).toEqual([]);
  });

  it("catches the regression if the registry ever activates one anyway", () => {
    const h = registryHygiene(
      [{ code: "HOLE", status: "ACTIVE" as const, requiredEvidence: [] }],
      new Set()
    );
    expect(h.activeWithoutEvidenceRule).toEqual(["HOLE"]);
  });
});

describe("claimDisplay — unverified, never zero", () => {
  const base = { value: "120.00", unit: "COUNT_PEOPLE" as const };

  it("publishes a number only when approved and still backed", () => {
    expect(claimDisplay({ ...base, status: "APPROVED", triage: CLEAN })).toEqual({
      kind: "verified",
      value: "120.00",
      unit: "COUNT_PEOPLE",
    });
  });

  it("renders every unbacked state as unverified and never emits a 0", () => {
    const cases = [
      { ...base, status: "SUBMITTED" as const, triage: CLEAN },
      { ...base, status: "NEEDS_EVIDENCE" as const, triage: blocked() },
      { ...base, status: "REJECTED" as const, triage: blocked() },
      { ...base, status: "WITHDRAWN" as const, triage: CLEAN },
      { ...base, status: "DRAFT" as const, triage: null },
      { ...base, status: "APPROVED" as const, triage: blocked() },
      { ...base, status: "APPROVED" as const, triage: null },
    ];
    for (const c of cases) {
      const d = claimDisplay(c);
      expect(d.kind).toBe("unverified");
      // The rule in one assertion: no zero, and a reason the reader can act on.
      expect(JSON.stringify(d)).not.toContain("0.00");
      expect("value" in d).toBe(false);
      expect((d as { reason: string }).reason.length).toBeGreaterThan(10);
    }
  });

  it("does not let an unrunnable check read as fine", () => {
    const d = claimDisplay({ ...base, status: "APPROVED", triage: null });
    expect(d).toEqual({
      kind: "unverified",
      reason: "The evidence behind this figure could not be checked.",
    });
  });
});

describe("sharePercent", () => {
  it("distinguishes 'nothing to measure' from 'nothing is backed'", () => {
    expect(sharePercent(null)).toBe("—");
    expect(sharePercent(0)).toBe("0%");
    expect(sharePercent(0.8137)).toBe("81%");
    expect(sharePercent(1)).toBe("100%");
  });
});

describe("alreadyCountedFrom", () => {
  // metricCode -> evidenceRef -> approved claims citing it
  const index = new Map([
    ["IB-MEALS-001", new Map([["photo-1", new Set(["claim-a", "claim-b"])]])],
    ["IB-TRAINED-001", new Map([["photo-1", new Set(["claim-c"])]])],
  ]);

  it("reports evidence another approved claim already counts", () => {
    expect(alreadyCountedFrom(index, "IB-MEALS-001", "claim-a")).toEqual(new Set(["photo-1"]));
  });

  it("excludes the claim being judged, so a claim never double-counts itself", () => {
    expect(alreadyCountedFrom(index, "IB-TRAINED-001", "claim-c")).toEqual(new Set());
  });

  it("is scoped to the metric — one capture can evidence two different facts", () => {
    // photo-1 is counted on IB-MEALS-001, but claiming it on IB-TRAINED-001 is
    // a different fact about the same event, not a double count.
    expect(alreadyCountedFrom(index, "IB-TRAINED-001", "claim-new")).toEqual(
      new Set(["photo-1"])
    );
    expect(alreadyCountedFrom(index, "IB-UNKNOWN", "claim-new")).toEqual(new Set());
  });
});

describe("incidentsFromIndex", () => {
  it("only reports evidence counted by two or more approved claims", () => {
    const index = new Map([
      [
        "IB-MEALS-001",
        new Map([
          ["photo-1", new Set(["claim-a", "claim-b"])],
          ["photo-2", new Set(["claim-a"])],
        ]),
      ],
    ]);
    const incidents = incidentsFromIndex(index);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ metricCode: "IB-MEALS-001", evidenceRef: "photo-1" });
    expect(incidents[0].claimIds.sort()).toEqual(["claim-a", "claim-b"]);
  });

  it("does not treat the same evidence on two different metrics as an incident", () => {
    const index = new Map([
      ["IB-MEALS-001", new Map([["photo-1", new Set(["claim-a"])]])],
      ["IB-SESSIONS-001", new Map([["photo-1", new Set(["claim-b"])]])],
    ]);
    expect(incidentsFromIndex(index)).toEqual([]);
  });

  it("puts the most-duplicated evidence first and caps only what is rendered", () => {
    const index = new Map([
      [
        "M",
        new Map([
          ["two", new Set(["a", "b"])],
          ["three", new Set(["a", "b", "c"])],
        ]),
      ],
    ]);
    expect(incidentsFromIndex(index).map((i) => i.evidenceRef)).toEqual(["three", "two"]);
    expect(incidentsFromIndex(index, 1)).toHaveLength(1);
  });
});
