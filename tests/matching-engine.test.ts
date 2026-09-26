import { describe, it, expect } from "vitest";
import {
  evaluateCandidate,
  rankCandidates,
  toMatchRequirement,
  DIMENSION_WEIGHTS,
  type CandidateProject,
  type MatchRequirement,
} from "@/src/agents/gap-diagnoser/matchingEngine";
import { withAiProvenance } from "@/lib/requirements/provenance";

const REQ: MatchRequirement = {
  sector: "Education",
  state: "Assam",
  district: "Kamrup",
  budgetMin: 5_000_000,
  budgetMax: 10_000_000,
  durationMonths: 24,
  expectedBeneficiaries: 1000,
  kpis: ["Improved learning outcomes", "School attendance"],
  reportingCadence: "Quarterly",
  fcraRequired: false,
  requires80G: false,
  requires12A: false,
};

const cand = (over: Partial<CandidateProject> = {}): CandidateProject => ({
  projectId: "p1",
  ngoId: "n1",
  ngoName: "Assam Education Foundation",
  projectTitle: "Digital classrooms",
  causeCategory: "Education",
  ngoCauseCategories: ["Education"],
  stateName: "Assam",
  districtName: "Kamrup",
  location: "Kamrup, Assam",
  targetAmount: 8_000_000,
  durationMonths: 24,
  outcomeText: "Improve learning outcomes and school attendance for 1,000 students",
  healthScore: 82,
  fcraStatus: "ACTIVE",
  eightyGVerified: true,
  twelveAVerified: true,
  ...over,
});

const dim = (e: ReturnType<typeof evaluateCandidate>, name: string) => e.dimensions.find((d) => d.dimension === name)!;

describe("matching engine — hard eligibility", () => {
  it("excludes an FCRA-ineligible NGO when FCRA is required, however good the fit", () => {
    const e = evaluateCandidate({ ...REQ, fcraRequired: true }, cand({ fcraStatus: "NONE" }));
    expect(e.eligible).toBe(false);
    expect(e.score).toBeNull();
    expect(e.hardEligibility).toContainEqual(expect.objectContaining({ rule: "FCRA registration", passed: false }));
    expect(dim(e, "Sector").result).toBe("MATCH");

    const { eligible, excluded } = rankCandidates({ ...REQ, fcraRequired: true }, [cand({ fcraStatus: "NONE" })]);
    expect(eligible).toHaveLength(0);
    expect(excluded).toHaveLength(1);
  });

  it("treats EXPIRED FCRA as ineligible and EXPIRING_SOON as still valid", () => {
    expect(evaluateCandidate({ ...REQ, fcraRequired: true }, cand({ fcraStatus: "EXPIRED" })).eligible).toBe(false);
    expect(evaluateCandidate({ ...REQ, fcraRequired: true }, cand({ fcraStatus: "EXPIRING_SOON" })).eligible).toBe(true);
  });

  it("does not apply the FCRA rule when the requirement does not ask for it", () => {
    const e = evaluateCandidate(REQ, cand({ fcraStatus: "NONE" }));
    expect(e.eligible).toBe(true);
    expect(dim(e, "FCRA").result).toBe("NOT_APPLICABLE");
  });

  it("excludes a project in a different state than the one required", () => {
    const e = evaluateCandidate(REQ, cand({ stateName: "Karnataka", districtName: "Bangalore Urban", location: "Bangalore" }));
    expect(e.eligible).toBe(false);
    expect(dim(e, "Geography").result).toBe("MISMATCH");
  });

  it("excludes an NGO without a required, verified 80G registration", () => {
    const e = evaluateCandidate({ ...REQ, requires80G: true }, cand({ eightyGVerified: false }));
    expect(e.eligible).toBe(false);
    expect(e.hardEligibility).toContainEqual(expect.objectContaining({ rule: "80G registration", passed: false }));
  });
});

describe("matching engine — soft dimensions", () => {
  it("scores a perfect candidate 100 with full coverage", () => {
    const e = evaluateCandidate(REQ, cand());
    expect(e.eligible).toBe(true);
    expect(e.score).toBe(100);
    expect(e.coverage).toBe(100);
    for (const name of Object.keys(DIMENSION_WEIGHTS)) expect(dim(e, name).result).toBe("MATCH");
  });

  it("classifies sector: exact, NGO-level only, mismatch", () => {
    expect(dim(evaluateCandidate(REQ, cand()), "Sector").result).toBe("MATCH");
    expect(dim(evaluateCandidate(REQ, cand({ causeCategory: "Health", ngoCauseCategories: ["Education", "Health"] })), "Sector").result).toBe("PARTIAL");
    expect(dim(evaluateCandidate(REQ, cand({ causeCategory: "Health", ngoCauseCategories: ["Health"] })), "Sector").result).toBe("MISMATCH");
  });

  it("classifies geography: district match, same state other district, unknown state", () => {
    expect(dim(evaluateCandidate(REQ, cand()), "Geography").result).toBe("MATCH");
    expect(dim(evaluateCandidate(REQ, cand({ districtName: "Barpeta" })), "Geography").result).toBe("PARTIAL");
    const unknown = evaluateCandidate(REQ, cand({ stateName: null, districtName: null, location: "Village road" }));
    expect(dim(unknown, "Geography").result).toBe("INSUFFICIENT_DATA");
    expect(unknown.eligible).toBe(true); // unknown is not proof of mismatch
  });

  it("compares budget ranges with partial overlap bands", () => {
    const r = (t: number) => dim(evaluateCandidate(REQ, cand({ targetAmount: t })), "Budget").result;
    expect(r(8_000_000)).toBe("MATCH");
    expect(r(12_000_000)).toBe("PARTIAL"); // ≤ 1.5 × max
    expect(r(20_000_000)).toBe("MISMATCH");
    expect(r(3_000_000)).toBe("PARTIAL"); // ≥ 0.5 × min
    expect(r(1_000_000)).toBe("MISMATCH");
  });

  it("compares duration and explains the gap with the actual values", () => {
    const e = evaluateCandidate(REQ, cand({ durationMonths: 18 }));
    const d = dim(e, "Duration");
    expect(d.result).toBe("PARTIAL");
    expect(d.explanation).toBe("Project duration is 18 months while the requirement specifies 24 months.");
    expect(d.projectValue).toBe("18 months");
    expect(dim(evaluateCandidate(REQ, cand({ durationMonths: 23 })), "Duration").result).toBe("MATCH");
    expect(dim(evaluateCandidate(REQ, cand({ durationMonths: 6 })), "Duration").result).toBe("MISMATCH");
  });

  it("compares KPIs against stated outcomes when that data exists", () => {
    expect(dim(evaluateCandidate(REQ, cand()), "Outcome KPIs").result).toBe("MATCH");
    expect(dim(evaluateCandidate(REQ, cand({ outcomeText: "Better learning outcomes in classrooms" })), "Outcome KPIs").result).toBe("PARTIAL");
    expect(dim(evaluateCandidate(REQ, cand({ outcomeText: "Tree plantation drive" })), "Outcome KPIs").result).toBe("MISMATCH");
  });
});

describe("matching engine — honest scoring", () => {
  it("marks missing candidate data INSUFFICIENT_DATA and leaves it out of the score", () => {
    const e = evaluateCandidate(REQ, cand({ durationMonths: null, outcomeText: null, healthScore: null }));
    for (const name of ["Duration", "Outcome KPIs", "Track record"]) {
      expect(dim(e, name).result).toBe("INSUFFICIENT_DATA");
      expect(dim(e, name).weight).toBe(0);
    }
    // Sector, geography, budget all match → 100 on what was compared, with reduced coverage.
    expect(e.score).toBe(100);
    expect(e.coverage).toBe(65);
  });

  it("never awards placeholder points — unmeasurable dimensions carry zero weight", () => {
    const e = evaluateCandidate(REQ, cand());
    expect(dim(e, "Beneficiaries").result).toBe("INSUFFICIENT_DATA");
    expect(dim(e, "Reporting cadence").result).toBe("INSUFFICIENT_DATA");
    for (const d of e.dimensions) {
      if (!["MATCH", "PARTIAL", "MISMATCH"].includes(d.result)) expect(d.weight).toBe(0);
      else expect(d.weight).toBe(DIMENSION_WEIGHTS[d.dimension] ?? 0);
    }
  });

  it("a single genuine mismatch lowers the score by exactly its weight", () => {
    const e = evaluateCandidate(REQ, cand({ causeCategory: "Health", ngoCauseCategories: ["Health"] }));
    expect(e.score).toBe(100 - DIMENSION_WEIGHTS.Sector);
  });

  it("sorts eligible candidates by score descending and drops ineligible ones", () => {
    const { eligible, excluded } = rankCandidates(REQ, [
      cand({ projectId: "mid", durationMonths: 18 }),
      cand({ projectId: "best" }),
      cand({ projectId: "low", causeCategory: "Health", ngoCauseCategories: ["Health"], targetAmount: 20_000_000 }),
      cand({ projectId: "out", stateName: "Kerala" }),
    ]);
    expect(eligible.map((e) => e.projectId)).toEqual(["best", "mid", "low"]);
    expect(eligible.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(eligible[0].score! >= eligible[1].score! && eligible[1].score! >= eligible[2].score!).toBe(true);
    expect(excluded.map((e) => e.projectId)).toEqual(["out"]);
  });

  it("builds the explanation from the structured comparison", () => {
    const e = evaluateCandidate(REQ, cand({ durationMonths: 18 }));
    expect(e.gaps[0].dimension).toBe("Duration");
    expect(e.gaps[0].recommendation).toBe("Request a revised implementation timeline of 24 months.");
    expect(e.explanation).toContain(`Scored ${e.score}/100`);
    expect(e.explanation).toContain(e.gaps[0].description);
  });
});

describe("toMatchRequirement", () => {
  it("derives FCRA and registration requirements only from explicit text", () => {
    const fields = withAiProvenance({
      sector: { value: "Education", confidence: 1 },
      specialConstraints: { value: "Implementing partner must hold valid FCRA registration", confidence: 1 },
      requiredDocuments: { value: ["80G certificate", "12A registration"], confidence: 1 },
    } as any);
    const r = toMatchRequirement(fields);
    expect(r.fcraRequired).toBe(true);
    expect(r.requires80G).toBe(true);
    expect(r.requires12A).toBe(true);

    const plain = toMatchRequirement(withAiProvenance({ sector: { value: "Education", confidence: 1 } } as any));
    expect(plain.fcraRequired).toBe(false);
    expect(plain.requires80G).toBe(false);
    expect(plain.budgetMax).toBeNull();
  });
});
