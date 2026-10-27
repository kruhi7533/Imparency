/**
 * AI-005 — NGO proposal-assist draft. Provider chain Claude → Gemini → TEMPLATE
 * with mocked models; the template uses only stated facts and never a number
 * it was not given; invitation and role gates on the route. DON-008 diff below.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ project: { findUnique: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/ai/claude", () => ({ isClaudeConfigured: () => false, claudeStructured: vi.fn(), CLAUDE_MODEL: "claude-test" }));
vi.mock("@/lib/requirements/opportunities", () => ({ getOpportunityForNgo: vi.fn() }));
vi.mock("@/lib/requirements/access", () => ({ resolveNgoMembership: vi.fn() }));

import { getOpportunityForNgo } from "@/lib/requirements/opportunities";
import { resolveNgoMembership } from "@/lib/requirements/access";
import { generateProposalDraft, templateDraft, draftWithFallback, type ProjectFacts } from "@/lib/requirements/proposal-draft";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import { diffProposals, diffWords } from "@/lib/requirements/proposal-diff";

const brief: any = {
  id: "req-1",
  title: "Digital literacy",
  sector: "Education",
  state: "Karnataka",
  district: null,
  budgetMin: 5_000_000,
  budgetMax: 7_500_000,
  currency: "INR",
  durationMonths: 12,
  expectedBeneficiaries: 1000,
  keyOutcomes: ["Reading fluency"],
  secondaryOutcomes: [],
  reportingCadence: "Quarterly",
  timeline: null,
  fcraRequired: true,
  requires80G: true,
  requires12A: false,
  requiredDocuments: ["FCRA registration", "Audited financials (last 3 years)"],
  publishedAt: null,
};
const project: ProjectFacts = {
  id: "p-1",
  title: "Reading camps",
  description: "After-school reading camps run by trained volunteers.",
  causeCategory: "Education",
  location: "Mysuru, Karnataka",
  stateName: "Karnataka",
  districtName: "Mysuru",
  problem_statement: null,
  expected_outcome: null,
  durationMonths: null,
  expectedBeneficiaries: null,
  beneficiaryGroup: null,
  reportingCadence: null,
};
const NGO = { id: "ngo-user", role: "NGO" as const, name: null, email: null };

beforeEach(() => {
  vi.clearAllMocks();
  (resolveNgoMembership as any).mockResolvedValue({ ngoId: "ngo-1", canRespond: true });
  (getOpportunityForNgo as any).mockResolvedValue({ brief, open: true, invitedProjects: [{ id: "p-1", title: "Reading camps" }], response: null });
  db.project.findUnique.mockResolvedValue(project);
  delete process.env.GEMINI_API_KEY;
});

describe("template draft (no model key)", () => {
  it("is labelled TEMPLATE, built from brief + project, with no invented numbers", async () => {
    const r = await generateProposalDraft({ requirementId: "req-1", actor: NGO, projectId: "p-1" });
    expect(r.generator).toBe("TEMPLATE");
    expect(r.fallbackReason).toBe("NO_PROVIDER_CONFIGURED");
    expect(r.notice).toMatch(/Template draft — no AI was used/);
    expect(r.draft.proposedBudget).toBeNull();
    expect(r.draft.milestones.every((m) => m.amount === null)).toBe(true);
    expect(r.draft.proposedDurationMonths).toBe(12); // from the brief, a stated fact
    expect(r.draft.implementationPlan).toContain("Reading camps");
    expect(r.draft.implementationPlan).toContain("[number and group of beneficiaries]"); // unknown → placeholder
    expect(r.draft.expectedOutcomes).toContain("Reading fluency");
    expect(r.draft.complianceNotes).toMatch(/FCRA/);
    // No rupee figure anywhere: the template never states money.
    expect(JSON.stringify(r.draft)).not.toMatch(/₹|\bINR\b|lakh|crore/i);
  });

  it("leaves duration empty when neither the brief nor the project states it", () => {
    const d = templateDraft({ ...brief, durationMonths: null }, project);
    expect(d.proposedDurationMonths).toBeNull();
    expect(d.implementationPlan).toContain("Duration: [number of months]");
    expect(d.milestones.every((m) => m.durationMonths === null)).toBe(true);
  });
});

describe("model chain (mocked)", () => {
  const model = {
    implementationPlan: "Plan text",
    expectedOutcomes: "- Reading fluency: [target]",
    complianceNotes: "FCRA: [number]",
    milestones: [{ title: "Baseline", durationMonths: 2 }, { title: "Bogus", durationMonths: 99 }],
  };

  it("uses Claude first, strips anything numeric it may not supply", async () => {
    const claude = vi.fn(async (_prompt: string) => model);
    const gemini = vi.fn();
    const r = await draftWithFallback(brief, project, [["CLAUDE", claude], ["GEMINI", gemini as any]]);
    expect(r.generator).toBe("CLAUDE");
    expect(gemini).not.toHaveBeenCalled();
    expect(r.draft.proposedBudget).toBeNull();
    expect(r.draft.milestones).toEqual([
      { title: "Baseline", amount: null, durationMonths: 2 },
      { title: "Bogus", amount: null, durationMonths: null }, // longer than the stated 12 months → dropped
    ]);
    expect(claude.mock.calls[0][0]).toContain("Never invent numbers");
  });

  it("falls through Claude → Gemini → TEMPLATE on errors or malformed output", async () => {
    const boom = vi.fn(async () => {
      throw new Error("503");
    });
    const malformed = vi.fn(async () => ({ nope: true }) as any);
    const viaGemini = await draftWithFallback(brief, project, [["CLAUDE", boom], ["GEMINI", vi.fn(async () => model)]]);
    expect(viaGemini.generator).toBe("GEMINI");
    const viaTemplate = await draftWithFallback(brief, project, [["CLAUDE", boom], ["GEMINI", malformed]]);
    expect(viaTemplate).toMatchObject({ generator: "TEMPLATE", fallbackReason: "PROVIDER_FAILED" });
  });
});

describe("gates", () => {
  it("an NGO that was not invited gets the brief's 403", async () => {
    (getOpportunityForNgo as any).mockRejectedValue(new RequirementWorkflowError("not available", 403));
    await expect(generateProposalDraft({ requirementId: "req-1", actor: NGO, projectId: "p-1" })).rejects.toMatchObject({ status: 403 });
    expect(db.project.findUnique).not.toHaveBeenCalled();
  });

  it("only an invited project of this NGO; never another org's project", async () => {
    await expect(generateProposalDraft({ requirementId: "req-1", actor: NGO, projectId: "someone-elses" })).rejects.toMatchObject({ status: 400 });
  });

  it("field staff cannot draft proposals; closed opportunities are refused", async () => {
    (resolveNgoMembership as any).mockResolvedValue({ ngoId: "ngo-1", canRespond: false });
    await expect(generateProposalDraft({ requirementId: "req-1", actor: NGO, projectId: "p-1" })).rejects.toMatchObject({ status: 403 });
    (resolveNgoMembership as any).mockResolvedValue({ ngoId: "ngo-1", canRespond: true });
    (getOpportunityForNgo as any).mockResolvedValue({ brief, open: false, invitedProjects: [{ id: "p-1", title: "x" }], response: null });
    await expect(generateProposalDraft({ requirementId: "req-1", actor: NGO, projectId: "p-1" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("DON-008 — V1 vs V2 proposal diff", () => {
  const v1 = {
    version: 1,
    proposedBudget: 6_000_000,
    proposedDurationMonths: 12,
    implementationPlan: "Run reading camps in 20 schools",
    expectedOutcomes: "Fluency up",
    complianceNotes: null,
    milestones: [{ title: "Baseline", amount: 1_000_000 }],
  };
  const v2 = { ...v1, version: 2, proposedBudget: 5_500_000, implementationPlan: "Run reading camps in 25 schools with libraries" };

  it("lists every field, marks changed ones, and gives a word-level diff", () => {
    const rows = diffProposals(v1, v2);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.proposedBudget).toMatchObject({ changed: true, before: "₹60,00,000", after: "₹55,00,000" });
    expect(byKey.proposedDurationMonths.changed).toBe(false);
    expect(byKey.milestones.changed).toBe(false);
    const tokens = byKey.implementationPlan.tokens!;
    expect(tokens.filter((t) => t.op === "removed").map((t) => t.text.trim())).toContain("20");
    expect(tokens.filter((t) => t.op === "added").map((t) => t.text).join("")).toMatch(/25.*with libraries/);
  });

  it("diffWords reconstructs both sides exactly", () => {
    const a = "one two three four";
    const b = "one three four five";
    const t = diffWords(a, b);
    expect(t.filter((x) => x.op !== "added").map((x) => x.text).join("")).toBe(a);
    expect(t.filter((x) => x.op !== "removed").map((x) => x.text).join("")).toBe(b);
  });
});
