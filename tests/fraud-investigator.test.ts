import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The investigator's safety story is the same shape as the deleted
 * caseworker's: forbidden capabilities are ABSENT from the tool surface, not
 * guarded inside it. These tests exist so adding one is a failing test, not a
 * code review someone skims.
 */

const prismaMock = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findMany: vi.fn() },
  donation: { findMany: vi.fn() },
  fraudAlert: { findFirst: vi.fn(), findMany: vi.fn() },
  riskReview: { findMany: vi.fn() },
  milestoneProof: { findMany: vi.fn() },
  ngoDocumentAnalysis: { findMany: vi.fn() },
  extractedField: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/verification-triage", () => ({ hasDuplicateIdentity: vi.fn() }));

import { DECLARATIONS, TERMINAL_TOOLS } from "@/lib/fraud-investigator/declarations";
import {
  READ_TOOLS,
  FORBIDDEN_TOOL_NAMES,
  getDonorOverlap,
  findSharedTeamMembers,
  getDocumentEvidence,
} from "@/lib/fraud-investigator/tools";

beforeEach(() => vi.clearAllMocks());

describe("declarations — capabilities that must not exist", () => {
  it("has no tool that can act on the NGO's status", () => {
    const declared = DECLARATIONS.map((d) => d.name);
    for (const forbidden of FORBIDDEN_TOOL_NAMES) {
      expect(declared, `${forbidden} must not be declared`).not.toContain(forbidden);
      expect(READ_TOOLS[forbidden], `${forbidden} must not be implemented`).toBeUndefined();
    }
  });

  it("declares exactly one write tool besides the terminal one", () => {
    // file_finding writes evidence; close_investigation just ends the run.
    // Nothing else is a write, and file_finding + close_investigation are
    // handled inline in run.ts rather than through READ_TOOLS — confirm they
    // are not accidentally read tools too.
    expect(READ_TOOLS.file_finding).toBeUndefined();
    expect(READ_TOOLS.close_investigation).toBeUndefined();
  });

  it("keeps declarations and read-tool implementations in correspondence", () => {
    const declaredReadTools = DECLARATIONS.map((d) => d.name).filter(
      (n) => n !== "file_finding" && n !== "close_investigation"
    );
    expect(declaredReadTools.sort()).toEqual(Object.keys(READ_TOOLS).sort());
  });

  it("declares no zero-property parameter schema", () => {
    // A function schema with no properties is what Groq's constrained decoding
    // choked on — 400 tool_use_failed, and before the loop learned to recover,
    // a dead investigation. Every no-argument tool carries an optional `reason`
    // instead. See NO_ARGS in declarations.ts.
    const empty = DECLARATIONS.filter((d) => Object.keys(d.parameters?.properties ?? {}).length === 0);
    expect(empty.map((d) => d.name)).toEqual([]);
  });

  it("close_investigation is the only terminal tool", () => {
    expect(Array.from(TERMINAL_TOOLS)).toEqual(["close_investigation"]);
  });
});

describe("get_donor_overlap — PII discipline", () => {
  it("returns donor ids, never names or emails", async () => {
    prismaMock.donation.findMany
      .mockResolvedValueOnce([{ donorId: "d1", amount: 500, createdAt: new Date() }])
      .mockResolvedValueOnce([{ donorId: "d1", amount: 300, createdAt: new Date() }]);

    const result = await getDonorOverlap({ otherNgoId: "ngo-2" }, { ngoId: "ngo-1", alertId: null });

    expect(result.overlappingDonorCount).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/@|name/i);
  });

  it("refuses to compare an NGO against itself", async () => {
    const result = await getDonorOverlap({ otherNgoId: "ngo-1" }, { ngoId: "ngo-1", alertId: null });
    expect(result.error).toBeTruthy();
  });
});

describe("get_document_evidence", () => {
  const ctx = { ngoId: "ngo-1", alertId: null };

  it("says outright that an unanalysed NGO is unanalysed, not clean", async () => {
    // The rule from CLAUDE.md: no evidence must never read as "safe". If this
    // ever returns an empty-but-cheerful shape, an investigator will close a
    // run believing the paperwork was checked.
    prismaMock.ngoDocumentAnalysis.findMany.mockResolvedValue([]);
    prismaMock.extractedField.findMany.mockResolvedValue([]);

    const result = await getDocumentEvidence({}, ctx);

    expect(result.analysed).toBe(false);
    expect(result.documents).toBeUndefined();
    expect(result.note).toMatch(/never been read/i);
  });

  it("reports each document's own name rather than one reconciled answer", async () => {
    // Per-document names are the whole point of NgoDocumentAnalysis
    // .orgNameOnDocument; collapsing them here would hide a certificate
    // belonging to a differently-named entity.
    prismaMock.ngoDocumentAnalysis.findMany.mockResolvedValue([
      {
        documentIndex: 0,
        docType: "REGISTRATION_CERTIFICATE",
        docTypeConfidence: 0.9,
        readable: true,
        note: null,
        orgNameOnDocument: "Prerna Gramin Vikas Trust",
      },
      {
        documentIndex: 1,
        docType: "TAX_EXEMPTION_80G",
        docTypeConfidence: 0.8,
        readable: true,
        note: null,
        orgNameOnDocument: "Prerna Welfare Foundation",
      },
    ]);
    prismaMock.extractedField.findMany.mockResolvedValue([]);

    const result = await getDocumentEvidence({}, ctx);

    expect(result.analysed).toBe(true);
    expect(result.documents!.map((d: any) => d.orgNameOnDocument)).toEqual([
      "Prerna Gramin Vikas Trust",
      "Prerna Welfare Foundation",
    ]);
  });

  it("carries each field's status so EXTRACTED is not mistaken for confirmed", async () => {
    prismaMock.ngoDocumentAnalysis.findMany.mockResolvedValue([]);
    prismaMock.extractedField.findMany.mockResolvedValue([
      {
        fieldKey: "panNumber",
        extractedValue: "AAATP1234C",
        submittedValue: "AAATP1234C",
        matchesSubmitted: true,
        confidence: 0.95,
        status: "EXTRACTED",
        flags: [],
      },
    ]);

    const result = await getDocumentEvidence({}, ctx);

    expect(result.fields![0].status).toBe("EXTRACTED");
    expect(result.fields![0].matchesSubmitted).toBe(true);
  });

  it("scopes both queries to the NGO under investigation", async () => {
    prismaMock.ngoDocumentAnalysis.findMany.mockResolvedValue([]);
    prismaMock.extractedField.findMany.mockResolvedValue([]);

    await getDocumentEvidence({}, ctx);

    expect(prismaMock.ngoDocumentAnalysis.findMany.mock.calls[0][0].where).toEqual({ ngoId: "ngo-1" });
    expect(prismaMock.extractedField.findMany.mock.calls[0][0].where).toEqual({ ngoId: "ngo-1" });
  });
});

describe("find_shared_team_members", () => {
  it("excludes the NGO under investigation from its own results", async () => {
    prismaMock.nGOTeamMember.findMany.mockResolvedValue([
      { role: "OWNER", ngo: { id: "ngo-2", orgName: "Other Trust", verificationStatus: "VERIFIED", isSuspended: false } },
    ]);

    await findSharedTeamMembers({ email: "a@b.com" }, { ngoId: "ngo-1", alertId: null });

    const where = prismaMock.nGOTeamMember.findMany.mock.calls[0][0].where;
    expect(where.ngoId).toEqual({ not: "ngo-1" });
  });
});
