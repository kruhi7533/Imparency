import { describe, it, expect } from "vitest";
import { serializeMatchRun } from "@/lib/requirements/dto";
import { readFileSync } from "fs";

// NEG-014: donor-facing responses carry no internal reviewer commentary or risk data.
const run = {
  id: "run1",
  createdAt: new Date("2026-10-27"),
  reviewStatus: "APPROVED",
  reviewNote: "Approved for the donor",
  matches: [
    { id: "m1", projectId: "p1", ngoId: "n1", eligible: true, rank: 1, score: 90, coverage: 90, explanation: "", adminDecision: "REJECTED", adminRank: null, adminNote: "Open fraud alert on this NGO" },
  ],
};

describe("serializeMatchRun donor redaction", () => {
  it("drops per-candidate admin notes for donors", () => {
    const dto = serializeMatchRun(run, { forDonor: true });
    expect(dto.matches[0].adminNote).toBeNull();
    expect(dto.matches[0].adminDecision).toBe("REJECTED");
    expect(dto.reviewNote).toBe("Approved for the donor");
  });
  it("keeps them for admins", () => {
    expect(serializeMatchRun(run).matches[0].adminNote).toBe("Open fraud alert on this NGO");
  });
});

describe("donor-feed payloads", () => {
  it("proof-submitted impact event carries ids only, no AI score", () => {
    const src = readFileSync("app/api/ngo/submit-proof/route.ts", "utf8");
    const block = src.slice(src.indexOf('type: "PROOF_SUBMITTED"'), src.indexOf('type: "PROOF_SUBMITTED"') + 900);
    expect(block).not.toMatch(/aiScore/);
  });
  it("donor contract-reports route blanks the admin review note", () => {
    const src = readFileSync("app/api/donor/contract-reports/route.ts", "utf8");
    expect(src).toMatch(/reviewNote: null/);
  });
});
