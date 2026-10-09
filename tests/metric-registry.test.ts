import { describe, it, expect } from "vitest";
import {
  validateMetricDefinition,
  acceptsNewClaims,
  claimRejectionReason,
  METRIC_CODE_PATTERN,
  SEED_METRICS,
  UNBACKED_EVIDENCE_KINDS,
  UNIT_LABELS,
  EVIDENCE_KIND_LABELS,
  type MetricDefinitionInput,
} from "@/lib/metric-registry";
import { SDG_MASTER, IRIS_MASTER } from "@/lib/impact-metrics";

function metric(over: Partial<MetricDefinitionInput> = {}): MetricDefinitionInput {
  return {
    code: "IB-TRAINED-001",
    name: "Individuals trained",
    unit: "COUNT_PEOPLE",
    definition:
      "A distinct person who completed a training activity. Does not count registrations.",
    status: "ACTIVE",
    sdgGoals: ["SDG4"],
    irisCode: "PI4060",
    requiredEvidence: ["MILESTONE_PROOF"],
    aggregatable: true,
    ...over,
  };
}

const fields = (errs: ReturnType<typeof validateMetricDefinition>) =>
  errs.map((e) => e.field).sort();

describe("validateMetricDefinition", () => {
  it("accepts a well-formed ACTIVE metric", () => {
    expect(validateMetricDefinition(metric())).toEqual([]);
  });

  /**
   * The load-bearing rule of the whole week. A metric with no required
   * evidence could never fail an evidence check, so every claim against it
   * would come back CLEAN having proved nothing — a permanent hole in "no
   * number without evidence".
   */
  it("refuses to activate a metric with no required evidence", () => {
    const errs = validateMetricDefinition(metric({ requiredEvidence: [] }));
    expect(fields(errs)).toEqual(["requiredEvidence"]);
    expect(errs[0].message).toContain("proved nothing");
  });

  it("allows a DRAFT metric to have no evidence rule yet", () => {
    // Drafts are work in progress; the gate is activation, not creation.
    expect(validateMetricDefinition(metric({ status: "DRAFT", requiredEvidence: [] }))).toEqual([]);
  });

  it("rejects duplicate evidence kinds", () => {
    const errs = validateMetricDefinition(
      metric({ requiredEvidence: ["FIELD_PHOTO", "FIELD_PHOTO"] })
    );
    expect(fields(errs)).toEqual(["requiredEvidence"]);
  });

  it("rejects a definition too short to judge a claim against", () => {
    expect(fields(validateMetricDefinition(metric({ definition: "people" })))).toEqual([
      "definition",
    ]);
  });

  it("rejects a missing name", () => {
    expect(fields(validateMetricDefinition(metric({ name: " " })))).toEqual(["name"]);
  });

  it("refuses an aggregatable percentage", () => {
    // Summing percentages across projects yields "340% of beneficiaries".
    const errs = validateMetricDefinition(metric({ unit: "PERCENTAGE", aggregatable: true }));
    expect(fields(errs)).toEqual(["aggregatable"]);
  });

  it("accepts a non-aggregatable percentage", () => {
    expect(validateMetricDefinition(metric({ unit: "PERCENTAGE", aggregatable: false }))).toEqual([]);
  });

  it("reports every problem at once", () => {
    const errs = validateMetricDefinition(
      metric({ code: "trained", name: "", definition: "x", requiredEvidence: [] })
    );
    expect(fields(errs)).toEqual(["code", "definition", "name", "requiredEvidence"]);
  });
});

describe("METRIC_CODE_PATTERN", () => {
  it.each(["IB-TRAINED-001", "IB-MEALS-001", "IB-WATER-FILTERS-042"])("accepts %s", (code) => {
    expect(METRIC_CODE_PATTERN.test(code)).toBe(true);
  });

  it.each([
    "ib-trained-001", // lowercase
    "IB-TRAINED-1", // not three digits
    "TRAINED-001", // no prefix
    "IB-TRAINED", // no number
    "IB-TRAINED-001 ", // trailing space
    "IB--001", // empty slug
  ])("rejects %p", (code) => {
    expect(METRIC_CODE_PATTERN.test(code)).toBe(false);
  });
});

describe("claim acceptance by status", () => {
  it("only ACTIVE metrics accept new claims", () => {
    expect(acceptsNewClaims("ACTIVE")).toBe(true);
    expect(acceptsNewClaims("DRAFT")).toBe(false);
    expect(acceptsNewClaims("DEPRECATED")).toBe(false);
  });

  it("explains the refusal, and says deprecation does not retract history", () => {
    expect(claimRejectionReason("ACTIVE")).toBeNull();
    expect(claimRejectionReason("DRAFT")).toContain("draft");
    // Deprecating must not read as "your approved numbers are gone".
    expect(claimRejectionReason("DEPRECATED")).toContain("Existing approved claims are unaffected");
  });
});

describe("SEED_METRICS", () => {
  it("is valid under the registry's own rules", () => {
    for (const m of SEED_METRICS) {
      expect(validateMetricDefinition(m), `${m.code} should be valid`).toEqual([]);
    }
  });

  it("has unique codes", () => {
    const codes = SEED_METRICS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  /**
   * The seed set must be provable with the evidence the platform actually
   * holds. A registry whose metrics mostly cannot be satisfied teaches admins
   * that BLOCKED is normal and should be clicked past.
   */
  it("requires only evidence kinds that a real table backs", () => {
    for (const m of SEED_METRICS) {
      for (const kind of m.requiredEvidence) {
        expect(UNBACKED_EVIDENCE_KINDS, `${m.code} requires ${kind}`).not.toContain(kind);
      }
    }
  });

  it("ships ACTIVE, so the NGO track has a contract rather than a fixture", () => {
    expect(SEED_METRICS.every((m) => m.status === "ACTIVE")).toBe(true);
    expect(SEED_METRICS.length).toBeGreaterThanOrEqual(5);
  });

  it("writes down what does NOT count, the half reviewers disagree on", () => {
    for (const m of SEED_METRICS) {
      expect(m.definition.toLowerCase(), `${m.code}`).toContain("does not count");
    }
  });

  it("keeps its SDG and IRIS crosswalks pointing at the existing dictionaries", () => {
    // lib/impact-metrics.ts is reused, not replaced — a code that is not in it
    // would render as a bare string in a donor report.
    for (const m of SEED_METRICS) {
      for (const g of m.sdgGoals) expect(SDG_MASTER, `${m.code} -> ${g}`).toHaveProperty(g);
      if (m.irisCode) expect(IRIS_MASTER, `${m.code} -> ${m.irisCode}`).toHaveProperty(m.irisCode);
    }
  });
});

describe("labels", () => {
  it("covers every unit and evidence kind the seed set uses", () => {
    for (const m of SEED_METRICS) {
      expect(UNIT_LABELS[m.unit]).toBeTruthy();
      for (const k of m.requiredEvidence) expect(EVIDENCE_KIND_LABELS[k]).toBeTruthy();
    }
  });
});
