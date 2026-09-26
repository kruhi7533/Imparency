import { describe, it, expect } from "vitest";
import { buildOpportunityBrief } from "@/lib/requirements/sanitize";
import { withAiProvenance } from "@/lib/requirements/provenance";

const fields = withAiProvenance({
  summary: { value: "Bharat Horizons Foundation invites proposals as part of its confidential FY27 strategy", confidence: 0.9 },
  sector: { value: "Education", confidence: 0.95 },
  state: { value: "Assam", confidence: 0.95 },
  district: { value: "Kamrup", confidence: 0.9 },
  budgetMin: { value: 5000000, confidence: 0.9 },
  budgetMax: { value: 10000000, confidence: 0.9 },
  durationMonths: { value: 24, confidence: 0.9 },
  expectedBeneficiaries: { value: 1000, confidence: 0.9 },
  primaryKPIs: { value: ["Improved learning outcomes (contact ops@bharat.org)"], confidence: 0.9 },
  reportingCadence: { value: "Quarterly", confidence: 0.9 },
  requiredDocuments: { value: ["80G certificate", "FCRA registration"], confidence: 0.9 },
  contactPerson: { value: "Asha Rao", confidence: 0.99 },
  contactEmail: { value: "asha.rao@bharat.org", confidence: 0.99 },
  contactPhone: { value: "+91 98765 43210", confidence: 0.99 },
  specialConstraints: { value: "Internal: board prefers partners we already fund", confidence: 0.8 },
} as any);

describe("sanitized NGO opportunity brief", () => {
  const brief = buildOpportunityBrief("req-1", fields);
  const json = JSON.stringify(brief);

  it("contains the facts an NGO needs", () => {
    expect(brief).toMatchObject({
      sector: "Education",
      state: "Assam",
      district: "Kamrup",
      budgetMin: 5000000,
      budgetMax: 10000000,
      durationMonths: 24,
      expectedBeneficiaries: 1000,
      reportingCadence: "Quarterly",
      fcraRequired: true,
      requires80G: true,
    });
    expect(brief.title).toBe("Education CSR opportunity in Assam");
  });

  it("never includes donor contact details, the AI summary, or confidential constraints", () => {
    expect(json).not.toContain("Asha Rao");
    expect(json).not.toContain("asha.rao@bharat.org");
    expect(json).not.toContain("98765");
    expect(json).not.toContain("Bharat Horizons");
    expect(json).not.toContain("board prefers");
    expect(json).not.toContain("ops@bharat.org"); // scrubbed from free text too
  });

  it("never includes AI confidence, provenance, or raw document data", () => {
    expect(json).not.toMatch(/confidence|AI_EXTRACTED|source|rawText|storageKey|fileName/);
    expect(Object.keys(brief)).not.toContain("summary");
    expect(Object.keys(brief)).not.toContain("contactEmail");
    expect(Object.keys(brief)).not.toContain("specialConstraints");
  });
});
