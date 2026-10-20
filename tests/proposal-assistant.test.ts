import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Grounded proposal assistant — AI-output tests on fixed fixtures, never a live
 * model call: citations are checked, invented ones stripped, uncited answers
 * flagged, and contact PII never reaches the prompt.
 */

const db = vi.hoisted(() => ({
  sponsorRequirement: { findUnique: vi.fn() },
  opportunityResponse: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import {
  answerProposalQuestion,
  buildPrompt,
  buildSources,
  checkGrounding,
  NOT_FOUND,
} from "@/lib/requirements/proposal-assistant";

const FIELDS = {
  sector: { value: "Education", confidence: 1 },
  state: { value: "Maharashtra", confidence: 1 },
  budgetMax: { value: 200000, confidence: 1 },
  contactEmail: { value: "csr@acme.example", confidence: 1 },
  contactPhone: { value: "9999999999", confidence: 1 },
};

const responseRow = (over: Record<string, any> = {}) => ({
  id: "resp-1",
  status: "PROPOSAL_SUBMITTED",
  version: 2,
  revisionRounds: 1,
  changeRequestNote: "Cut the budget",
  changeRequestedAt: new Date(),
  ngo: { id: "ngo-1", orgName: "HopeBridge Foundation", logo_url: null, healthScore: 82 },
  project: { id: "p-1", title: "Digital Learning", targetAmount: 100000 },
  proposedBudget: 120000,
  proposedDurationMonths: 12,
  implementationPlan: "Train 40 teachers",
  expectedOutcomes: "500 students",
  complianceNotes: "80G registered",
  milestones: [{ title: "Setup", amount: 60000 }],
  submittedAt: new Date(),
  revisions: [
    { version: 1, status: "CHANGES_REQUESTED", proposedBudget: 150000, proposedDurationMonths: 12, implementationPlan: "Train 30", milestones: [], submittedAt: new Date(), createdAt: new Date(), supersededBecause: "Cut the budget" },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.sponsorRequirement.findUnique.mockResolvedValue({ id: "req-1", sponsorId: "donor-1", status: "NGO_RESPONSE", extractedFields: FIELDS });
  db.opportunityResponse.findMany.mockResolvedValue([responseRow()]);
});

describe("building the fact sheet", () => {
  it("numbers the requirement, each current proposal and each superseded version", async () => {
    const { listResponses } = await import("@/lib/requirements/queries");
    const sources = buildSources(FIELDS, await listResponses("req-1"));
    expect(sources.map((s) => s.label)).toEqual([
      "Your requirement",
      "HopeBridge Foundation — proposal V2 (current)",
      "HopeBridge Foundation — proposal V1 (superseded)",
    ]);
    expect(sources[1].text).toContain("₹1,20,000");
    expect(sources[2].text).toContain("₹1,50,000");
  });

  it("never puts the donor's contact details in front of the model", async () => {
    const { listResponses } = await import("@/lib/requirements/queries");
    const prompt = buildPrompt("Who should we call?", buildSources(FIELDS, await listResponses("req-1")));
    expect(prompt).not.toContain("csr@acme.example");
    expect(prompt).not.toContain("9999999999");
  });
});

describe("grounding check", () => {
  const sources = [
    { id: "S1", label: "req", text: "" },
    { id: "S2", label: "p", text: "" },
  ];

  it("keeps valid citations", () => {
    expect(checkGrounding("Budget is ₹1,20,000 [S2].", sources)).toMatchObject({ citations: ["S2"], invalidCitations: [], grounded: true });
  });

  it("strips citations to sources that do not exist (hallucinated) and reports them", () => {
    const r = checkGrounding("Budget is ₹9,99,999 [S7]. Sector is Education [S1].", sources);
    expect(r.answer).not.toContain("[S7]");
    expect(r.invalidCitations).toEqual(["S7"]);
    expect(r.citations).toEqual(["S1"]);
  });

  it("an answer with no valid citation is flagged as ungrounded", () => {
    expect(checkGrounding("HopeBridge is clearly the best choice.", sources).grounded).toBe(false);
    expect(checkGrounding("Made up [S9].", sources).grounded).toBe(false);
  });

  it("an explicit not-found is grounded", () => {
    expect(checkGrounding(NOT_FOUND, sources).grounded).toBe(true);
  });
});

describe("answerProposalQuestion", () => {
  const DONOR = { id: "donor-1", role: "DONOR" as const, name: null, email: null };

  it("passes the fact sheet to the model and returns the checked answer", async () => {
    const generate = vi.fn(async (_prompt: string) => "HopeBridge cut its budget from ₹1,50,000 to ₹1,20,000 [S3][S2]. Invented [S8].");
    const r = await answerProposalQuestion({ requirementId: "req-1", actor: DONOR, question: "What changed?", generate });
    expect(generate.mock.calls[0][0]).toContain("[S3] HopeBridge Foundation — proposal V1 (superseded)");
    expect(r).toMatchObject({ usedModel: true, grounded: true, citations: ["S3", "S2"], invalidCitations: ["S8"] });
    expect(r.answer).not.toContain("[S8]");
  });

  it("falls back to the cited facts when no model is available", async () => {
    const r = await answerProposalQuestion({ requirementId: "req-1", actor: DONOR, question: "Compare budgets", generate: async () => null });
    expect(r.usedModel).toBe(false);
    expect(r.answer).toContain("₹1,20,000");
    expect(r.citations).toEqual(["S2"]);
  });

  it("a model error degrades to the fallback rather than failing", async () => {
    const r = await answerProposalQuestion({
      requirementId: "req-1",
      actor: DONOR,
      question: "Compare budgets",
      generate: async () => {
        throw new Error("503");
      },
    });
    expect(r.usedModel).toBe(false);
  });

  it("validates the question and enforces tenant isolation", async () => {
    await expect(answerProposalQuestion({ requirementId: "req-1", actor: DONOR, question: "?", generate: async () => "x" })).rejects.toMatchObject({ status: 400 });
    for (const actor of [
      { id: "donor-2", role: "DONOR" as const, name: null, email: null },
      { id: "ngo-user", role: "NGO" as const, name: null, email: null },
    ]) {
      await expect(answerProposalQuestion({ requirementId: "req-1", actor, question: "Compare budgets", generate: async () => "x" })).rejects.toMatchObject({ status: 403 });
    }
  });
});
