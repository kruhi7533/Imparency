import { describe, it, expect } from "vitest";
import { assessVerificationStanding } from "@/lib/verification-standing";

/**
 * The rule under test: a VERIFIED organisation whose evidence does not support
 * that status must not render as clean. See lib/verification-standing.ts for
 * the two live cases this was written from.
 */

const base = {
  verificationStatus: "VERIFIED",
  noExtraction: false,
  outstandingCount: 0,
  openHighDefects: 0,
};

describe("assessVerificationStanding", () => {
  it("says nothing about an organisation that is not verified", () => {
    // The PENDING queue already renders absence honestly; repeating it here
    // would train people to ignore the banner.
    for (const status of ["PENDING", "REJECTED"]) {
      const s = assessVerificationStanding({ ...base, verificationStatus: status, noExtraction: true, openHighDefects: 3 });
      expect(s.level).toBe("OK");
      expect(s.alarming).toBe(false);
    }
  });

  it("is quiet when a verified organisation's evidence holds up", () => {
    expect(assessVerificationStanding(base).level).toBe("OK");
  });

  it("flags a verified organisation with no extraction at all", () => {
    // Anmol Vikas Trust: VERIFIED, zero ExtractedField rows, page read clean.
    const s = assessVerificationStanding({ ...base, noExtraction: true });
    expect(s.level).toBe("UNSUPPORTED");
    expect(s.alarming).toBe(true);
    expect(s.headline).toMatch(/no evidence/i);
  });

  it("flags a verified organisation with open high-severity defects", () => {
    // Tejamma: name, PAN and registration number all contradict the form.
    const s = assessVerificationStanding({ ...base, openHighDefects: 3 });
    expect(s.level).toBe("CONTRADICTED");
    expect(s.alarming).toBe(true);
    expect(s.headline).toContain("3 high-severity defects");
  });

  it("ranks a contradiction above an absence", () => {
    // "The documents name a different organisation" is a question about
    // identity; "we never looked" is a question about process.
    const s = assessVerificationStanding({ ...base, noExtraction: true, openHighDefects: 1 });
    expect(s.level).toBe("CONTRADICTED");
    expect(s.headline).toContain("1 high-severity defect");
    expect(s.headline).not.toContain("defects");
  });

  it("treats unreviewed fields as unfinished, not as a defect", () => {
    const s = assessVerificationStanding({ ...base, outstandingCount: 2 });
    expect(s.level).toBe("INCOMPLETE");
    expect(s.alarming).toBe(false);
    expect(s.detail).toMatch(/not a defect/i);
  });

  it("pluralises one outstanding field correctly", () => {
    const s = assessVerificationStanding({ ...base, outstandingCount: 1 });
    expect(s.headline).toContain("1 field still awaiting");
  });
});
