import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ADM-015 / DON-014 / AI-007 / AI-008 — consent-safe impact stories.
 *  - the consent filter runs BEFORE any provider and is deterministic;
 *  - provider order Claude → Gemini → template, falling through on any error
 *    or rule-breaking output (models mocked — no live calls);
 *  - admin review before publication, consent re-checked at publish time.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    project: { findUnique: vi.fn() },
    fieldEvidence: { findMany: vi.fn() },
    impactStory: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    contract: { findUnique: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/ai/claude", () => ({ isClaudeConfigured: vi.fn(() => false), claudeStructured: vi.fn() }));
vi.mock("@/lib/outcome-cockpit", () => ({
  loadDonorProjectOutcomes: vi.fn(async () => ({
    rows: [
      { metricName: "People trained", unit: "PEOPLE", display: { kind: "verified", value: "120", unit: "PEOPLE" } },
      { metricName: "Meals served", unit: "MEALS", display: { kind: "unverified", reason: "not reviewed" } },
    ],
  })),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { claudeStructured, isClaudeConfigured } from "@/lib/ai/claude";
import { logAdminAction } from "@/lib/admin-log";
import {
  selectStoryMaterial,
  validateStoryOutput,
  templateStory,
  buildStoryPrompt,
  scrubQuote,
  storyTransition,
  TEMPLATE_LABEL,
  type StoryCandidate,
  type StoryContext,
} from "@/lib/impact-stories";
import { generateStory, runStoryProviders, claudeStoryProvider, type StoryProvider } from "@/lib/impact-story-service";
import { POST as GENERATE } from "@/app/api/ngo/impact-stories/route";
import { PATCH as ADMIN_DECIDE } from "@/app/api/admin/impact-stories/[id]/route";

const db = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });

const base: StoryCandidate = {
  feedbackId: "fb-ok",
  evidenceId: "ev-ok",
  consentToRecord: true,
  consentToSharePhoto: true,
  storyConsent: "PUBLIC",
  withdrawnAt: null,
  feedbackText: "The training helped me find work.",
  rating: 5,
  evidenceStatus: "APPROVED",
  containsPeople: true,
  beneficiaryRef: "HH-014",
};
const FIXTURE: StoryCandidate[] = [
  base,
  { ...base, feedbackId: "fb-donor", evidenceId: "ev-donor", storyConsent: "DONOR_ONLY", feedbackText: "Only for the funder please." },
  { ...base, feedbackId: "fb-none", evidenceId: "ev-none", storyConsent: "NONE", consentToSharePhoto: false, feedbackText: "No story consent here." },
  { ...base, feedbackId: "fb-withdrawn", evidenceId: "ev-withdrawn", withdrawnAt: new Date(), feedbackText: "WITHDRAWN TEXT" },
  { ...base, feedbackId: "fb-pending", evidenceId: "ev-pending", evidenceStatus: "PENDING_REVIEW", feedbackText: "Not reviewed yet." },
  { ...base, feedbackId: null, evidenceId: "ev-wall", containsPeople: false, feedbackText: null },
  { ...base, feedbackId: null, evidenceId: "ev-person-noconsent", containsPeople: true, feedbackText: null },
];

describe("selectStoryMaterial — the consent filter (deterministic)", () => {
  it("DONOR variant: DONOR_ONLY and PUBLIC quotes; never withdrawn, unconsented or unreviewed", () => {
    const m = selectStoryMaterial("DONOR", FIXTURE);
    expect(m.quotes.map((q) => q.feedbackId).sort()).toEqual(["fb-donor", "fb-ok"]);
    expect(m.photoEvidenceIds.sort()).toEqual(["ev-donor", "ev-ok", "ev-wall"]);
    const reasons = Object.fromEntries(m.excluded.map((e) => [e.ref, e.reason]));
    expect(reasons["fb-withdrawn"]).toBe("CONSENT_WITHDRAWN");
    expect(reasons["fb-none"]).toBe("NO_STORY_CONSENT_FOR_AUDIENCE");
    expect(reasons["fb-pending"]).toBe("NOT_APPROVED");
    expect(reasons["ev-person-noconsent"]).toBe("NO_PHOTO_CONSENT_FOR_AUDIENCE");
  });
  it("PUBLIC variant: only PUBLIC-scope quotes, and a people photo needs PUBLIC scope too", () => {
    const m = selectStoryMaterial("PUBLIC", FIXTURE);
    expect(m.quotes.map((q) => q.feedbackId)).toEqual(["fb-ok"]);
    expect(m.photoEvidenceIds.sort()).toEqual(["ev-ok", "ev-wall"]);
  });
  it("never forwards the pseudonymous beneficiaryRef, and scrubs contact details", () => {
    const m = selectStoryMaterial("DONOR", [{ ...base, feedbackText: "Call me on +91 98765 43210 or a@b.org" }]);
    expect(JSON.stringify(m)).not.toContain("HH-014");
    expect(m.quotes[0].text).not.toMatch(/98765|a@b\.org/);
    expect(scrubQuote("mail x@y.com")).toBe("mail [removed]");
  });
  it("excluded text never reaches the prompt", () => {
    const material = selectStoryMaterial("PUBLIC", FIXTURE);
    const prompt = buildStoryPrompt({ variant: "PUBLIC", projectTitle: "Skills", orgName: "Org", location: null, figures: [], material });
    expect(prompt).not.toContain("WITHDRAWN TEXT");
    expect(prompt).not.toContain("Only for the funder");
    expect(prompt).not.toContain("No story consent");
    expect(prompt).not.toContain("HH-014");
  });
});

const ctx: StoryContext = {
  variant: "DONOR",
  projectTitle: "Skills for Work",
  orgName: "Akshar",
  location: "Pune",
  figures: [{ metricName: "People trained", value: "120", unit: "people" }],
  material: selectStoryMaterial("DONOR", [base]),
};

describe("validateStoryOutput — schema and hard rules", () => {
  it("accepts a draft that only uses supplied numbers", () => {
    expect(validateStoryOutput({ title: "A year of skills", body: "With your support, 120 people trained in Pune found new confidence and work." }, ctx)).toMatchObject({ ok: true });
  });
  it("refuses a hallucinated figure", () => {
    expect(validateStoryOutput({ title: "Wow", body: "With your support, 5000 people trained in Pune found new confidence and work." }, ctx)).toEqual({ ok: false, error: "MODEL_OUTPUT_UNSUPPORTED_NUMBER" });
  });
  it("refuses missing fields and non-objects", () => {
    expect(validateStoryOutput(null, ctx)).toMatchObject({ ok: false });
    expect(validateStoryOutput({ title: "x" }, ctx)).toEqual({ ok: false, error: "MODEL_OUTPUT_MISSING_BODY" });
  });
  it("the template is labelled and uses only verified figures and consented quotes", () => {
    const t = templateStory(ctx);
    expect(t.body).toContain(TEMPLATE_LABEL);
    expect(t.body).toContain("120 people");
    expect(validateStoryOutput(t, ctx)).toMatchObject({ ok: true });
  });
});

describe("provider chain: Claude → Gemini → template", () => {
  const good = { title: "Skills update", body: "With your support, 120 people trained in Pune found new confidence and work." };
  const prov = (name: "CLAUDE" | "GEMINI", available: boolean, call: () => Promise<unknown>): StoryProvider => ({ name, available: () => available, call });

  it("uses Claude when configured", async () => {
    const r = await runStoryProviders([prov("CLAUDE", true, async () => good), prov("GEMINI", true, async () => good)], ctx);
    expect(r).toMatchObject({ provider: "CLAUDE" });
  });
  it("falls through to Gemini when Claude throws", async () => {
    const gem = vi.fn(async () => good);
    const r = await runStoryProviders([prov("CLAUDE", true, async () => { throw new Error("overloaded"); }), prov("GEMINI", true, gem)], ctx);
    expect(r).toMatchObject({ provider: "GEMINI" });
  });
  it("falls through when output breaks a hard rule", async () => {
    const r = await runStoryProviders([prov("CLAUDE", true, async () => ({ title: "x", body: "We trained 9999 people this year in Pune, a record." }))], ctx);
    expect(r).toEqual({ story: null, reason: "MODEL_OUTPUT_UNSUPPORTED_NUMBER" });
  });
  it("with no keys at all, no provider is called", async () => {
    const call = vi.fn();
    const r = await runStoryProviders([prov("CLAUDE", false, call), prov("GEMINI", false, call)], ctx);
    expect(r).toEqual({ story: null, reason: "AI_PROVIDER_UNAVAILABLE" });
    expect(call).not.toHaveBeenCalled();
  });
  it("the Claude provider calls the shared module (mocked)", async () => {
    (isClaudeConfigured as any).mockReturnValueOnce(true);
    (claudeStructured as any).mockResolvedValueOnce(good);
    expect(claudeStoryProvider.available()).toBe(true);
    expect(await claudeStoryProvider.call("prompt")).toEqual(good);
    expect((claudeStructured as any).mock.calls[0][0].content[0].text).toBe("prompt");
  });
});

describe("generateStory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    db.project.findUnique.mockResolvedValue({ id: "p-1", ngoId: "ngo-a", title: "Skills for Work", location: "Pune", ngo: { orgName: "Akshar" } });
    db.fieldEvidence.findMany.mockResolvedValue(
      FIXTURE.filter((c) => c.evidenceId).map((c) => ({
        id: c.evidenceId,
        status: c.evidenceStatus,
        containsPeople: c.containsPeople,
        feedback: c.feedbackId
          ? { id: c.feedbackId, consentToRecord: c.consentToRecord, consentToSharePhoto: c.consentToSharePhoto, storyConsent: c.storyConsent, withdrawnAt: c.withdrawnAt, feedbackText: c.feedbackText, rating: c.rating }
          : null,
      })),
    );
    db.impactStory.create.mockResolvedValue({ id: "st-1" });
  });

  it("with no model key stores a TEMPLATE draft built from filtered material only", async () => {
    const r = await generateStory({ ngoId: "ngo-a", projectId: "p-1", contractId: null, variant: "PUBLIC", userId: "u-a" });
    expect(r).toMatchObject({ ok: true, generator: "TEMPLATE", fallbackReason: "AI_PROVIDER_UNAVAILABLE" });
    const data = db.impactStory.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ generator: "TEMPLATE", variant: "PUBLIC", sourceFeedbackIds: ["fb-ok"] });
    expect(data.body).toContain(TEMPLATE_LABEL);
    expect(data.body).not.toContain("WITHDRAWN");
    expect(data.body).not.toContain("Meals"); // unverified figure is not a story number
    expect(data.status).toBeUndefined(); // DRAFT by default — never auto-published
  });
  it("records the provider that wrote it", async () => {
    const good = { title: "Skills", body: "With your support, 120 people trained in Pune found new confidence and work." };
    const r = await generateStory({ ngoId: "ngo-a", projectId: "p-1", contractId: null, variant: "DONOR", userId: "u-a", providers: [{ name: "CLAUDE", available: () => true, call: async () => good }] });
    expect(r).toMatchObject({ ok: true, generator: "CLAUDE" });
  });
  it("another NGO's project is 404", async () => {
    expect(await generateStory({ ngoId: "ngo-b", projectId: "p-1", contractId: null, variant: "DONOR", userId: "u-b" })).toMatchObject({ ok: false, status: 404 });
  });
});

describe("routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.nGOProfile.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.userId === "u-a" ? { id: "ngo-a" } : null));
    db.nGOTeamMember.findFirst.mockImplementation(({ where }: any) => Promise.resolve(where.userId === "u-field" ? { ngoId: "ngo-a", role: "FIELD_STAFF" } : null));
  });
  it("field staff cannot generate", async () => {
    session("u-field", "NGO");
    const res = await GENERATE(new Request("http://t", { method: "POST", body: JSON.stringify({ projectId: "p-1", variant: "DONOR" }) }));
    expect(res.status).toBe(403);
  });
  it("story lifecycle needs the admin to publish", () => {
    expect(storyTransition("PUBLISH", "IN_REVIEW", "NGO")).toMatchObject({ ok: false, status: 403 });
    expect(storyTransition("PUBLISH", "DRAFT", "ADMIN")).toMatchObject({ ok: false, status: 409 });
    expect(storyTransition("SUBMIT", "DRAFT", "NGO")).toEqual({ ok: true, to: "IN_REVIEW" });
  });
  it("admin publish re-checks consent and refuses a story whose material lost it", async () => {
    session("admin-1", "ADMIN");
    db.impactStory.findUnique.mockResolvedValue({ id: "st-1", ngoId: "ngo-a", projectId: "p-1", status: "IN_REVIEW", variant: "PUBLIC", generator: "TEMPLATE", sourceFeedbackIds: ["fb-ok"], sourceEvidenceIds: [] });
    db.fieldEvidence.findMany.mockResolvedValue([
      { id: "ev-ok", status: "APPROVED", containsPeople: true, feedback: { id: "fb-ok", consentToRecord: true, consentToSharePhoto: true, storyConsent: "PUBLIC", withdrawnAt: new Date(), feedbackText: null, rating: null } },
    ]);
    db.impactStory.updateMany.mockResolvedValue({ count: 1 });
    const res = await ADMIN_DECIDE(new Request("http://t", { method: "PATCH", body: JSON.stringify({ action: "PUBLISH" }) }), { params: { id: "st-1" } });
    expect(res.status).toBe(409);
    expect(db.impactStory.updateMany.mock.calls[0][0].data).toMatchObject({ status: "NEEDS_REGENERATION", publishedAt: null });
    expect(logAdminAction).not.toHaveBeenCalled();
  });
  it("admin publishes a story whose consent still holds, and logs it", async () => {
    session("admin-1", "ADMIN");
    db.impactStory.findUnique.mockResolvedValue({ id: "st-1", ngoId: "ngo-a", projectId: "p-1", status: "IN_REVIEW", variant: "PUBLIC", generator: "TEMPLATE", sourceFeedbackIds: ["fb-ok"], sourceEvidenceIds: ["ev-ok"], createdAt: new Date() });
    db.fieldEvidence.findMany.mockResolvedValue([
      { id: "ev-ok", status: "APPROVED", containsPeople: true, feedback: { id: "fb-ok", consentToRecord: true, consentToSharePhoto: true, storyConsent: "PUBLIC", withdrawnAt: null, feedbackText: "ok text here", rating: 5 } },
    ]);
    db.impactStory.updateMany.mockResolvedValue({ count: 1 });
    const res = await ADMIN_DECIDE(new Request("http://t", { method: "PATCH", body: JSON.stringify({ action: "PUBLISH" }) }), { params: { id: "st-1" } });
    expect(res.status).toBe(200);
    expect((logAdminAction as any).mock.calls[0][0]).toMatchObject({ action: "IMPACT_STORY_PUBLISHED", entityType: "IMPACT_STORY", entityId: "st-1" });
  });
});
