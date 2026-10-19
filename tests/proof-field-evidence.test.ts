import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Approved field evidence attached to a milestone proof by reference.
 * Tenant isolation (another NGO's evidence or milestone), the approval gate
 * (only APPROVED evidence), and the privacy rule: field photos never reach
 * the public `mediaUrls` or the duplicate-hash list.
 */

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  milestone: { findUnique: vi.fn(), update: vi.fn() },
  milestoneProof: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  fieldEvidence: { findMany: vi.fn() },
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn().mockResolvedValue("/uploads/proofs/x/a.jpg") }));
vi.mock("@/lib/ngo-health", () => ({ recalculateNGOHealthScore: vi.fn() }));
vi.mock("@/lib/impact-events", () => ({ emitProjectImpactEvent: vi.fn() }));
vi.mock("@/lib/risk-agent", () => ({ checkGeminiScore: vi.fn() }));
vi.mock("@/lib/fraud-alerts", () => ({ createFraudAlert: vi.fn() }));
vi.mock("@/lib/gemini/validate-proof", () => ({
  validateMilestoneProof: vi.fn().mockResolvedValue({
    score: 80, reasoning: "r", flags: [], suggestion: "s", tocAlignmentScore: 70, tocReasoning: "t", tocStrengths: [], tocGaps: [],
  }),
}));

import { getServerSession } from "next-auth/next";
import { validateMilestoneProof } from "@/lib/gemini/validate-proof";
import { emitProjectImpactEvent } from "@/lib/impact-events";
import { checkAttachableEvidence, MAX_ATTACHED_EVIDENCE } from "@/lib/proof-field-evidence";
import { POST as SUBMIT_PROOF } from "@/app/api/ngo/submit-proof/route";
import { GET as LIST } from "@/app/api/ngo/milestones/[id]/field-evidence/route";

const TARGET = { ngoId: "ngo-a", projectId: "proj-a", milestoneId: "ms-a" };
const ev = (over: Partial<{ id: string; ngoId: string; projectId: string; milestoneId: string | null; status: string }> = {}) => ({
  id: "ev-1", ngoId: "ngo-a", projectId: "proj-a", milestoneId: null, status: "APPROVED", ...over,
});

describe("checkAttachableEvidence", () => {
  it("accepts this NGO's approved evidence on this project, unassigned or for this milestone; de-duplicates ids", () => {
    const r = checkAttachableEvidence(["ev-1", "ev-2", "ev-1"], [ev(), ev({ id: "ev-2", milestoneId: "ms-a" })], TARGET);
    expect(r).toEqual({ ok: true, ids: ["ev-1", "ev-2"] });
  });

  it("refuses evidence still pending, resubmit-requested or rejected", () => {
    for (const status of ["PENDING_REVIEW", "RESUBMIT_REQUESTED", "REJECTED"]) {
      expect(checkAttachableEvidence(["ev-1"], [ev({ status })], TARGET).ok).toBe(false);
    }
  });

  it("another NGO's evidence reads as not found; another project's or milestone's is refused", () => {
    const other = checkAttachableEvidence(["ev-1"], [ev({ ngoId: "ngo-b" })], TARGET);
    expect(other).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    expect(checkAttachableEvidence(["ev-1"], [], TARGET).ok).toBe(false);
    expect(checkAttachableEvidence(["ev-1"], [ev({ projectId: "proj-b" })], TARGET).ok).toBe(false);
    expect(checkAttachableEvidence(["ev-1"], [ev({ milestoneId: "ms-other" })], TARGET).ok).toBe(false);
  });

  it(`caps attachments at ${MAX_ATTACHED_EVIDENCE}`, () => {
    const ids = Array.from({ length: MAX_ATTACHED_EVIDENCE + 1 }, (_, i) => `ev-${i}`);
    expect(checkAttachableEvidence(ids, ids.map((id) => ev({ id })), TARGET).ok).toBe(false);
  });
});

function proofRequest(opts: { evidence?: string[]; withFile?: boolean }) {
  const form = new FormData();
  form.append("milestoneId", "ms-a");
  form.append("description", "Installed projectors in all five schools.");
  if (opts.withFile) form.append("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  for (const id of opts.evidence ?? []) form.append("fieldEvidenceIds", id);
  return new Request("http://localhost", { method: "POST", body: form });
}

describe("POST /api/ngo/submit-proof with field evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "owner-a", role: "NGO" } });
    db.user.findUnique.mockResolvedValue({ id: "owner-a", ngoProfile: { id: "ngo-a", verificationStatus: "VERIFIED", isSuspended: false } });
    db.milestone.findUnique.mockResolvedValue({
      id: "ms-a", title: "Installation", description: "d", targetAmount: 1000, deadline: new Date("2026-12-01"), status: "IN_PROGRESS",
      projectId: "proj-a", project: { ngoId: "ngo-a", problem_statement: null, expected_outcome: null, latitude: null, longitude: null },
    });
    db.milestoneProof.create.mockResolvedValue({ id: "proof-1" });
    db.fieldEvidence.findMany.mockResolvedValue([ev()]);
  });

  it("evidence alone is enough: stored as ids, not as public media, not as hashes; milestone goes to review", async () => {
    const res = await SUBMIT_PROOF(proofRequest({ evidence: ["ev-1"] }));
    expect(res.status).toBe(200);
    const { data } = db.milestoneProof.create.mock.calls[0][0];
    expect(data.fieldEvidenceIds).toEqual(["ev-1"]);
    expect(data.mediaUrls).toEqual([]);
    expect(data.contentHashes).toEqual([]);
    expect(db.milestone.update).toHaveBeenCalledWith({ where: { id: "ms-a" }, data: { status: "PROOF_SUBMITTED" } });
  });

  it("the attached photos are described to the model, never sent to it", async () => {
    await SUBMIT_PROOF(proofRequest({ evidence: ["ev-1"] }));
    const [, , description, files] = (validateMilestoneProof as any).mock.calls[0];
    expect(files).toEqual([]);
    expect(description).toContain("1 field evidence item(s) already approved");
  });

  it("another NGO's evidence is refused and nothing is written", async () => {
    db.fieldEvidence.findMany.mockResolvedValue([ev({ ngoId: "ngo-b" })]);
    expect((await SUBMIT_PROOF(proofRequest({ evidence: ["ev-1"] }))).status).toBe(400);
    expect(db.milestoneProof.create).not.toHaveBeenCalled();
    expect(db.milestone.update).not.toHaveBeenCalled();
  });

  it("unapproved evidence is refused", async () => {
    db.fieldEvidence.findMany.mockResolvedValue([ev({ status: "PENDING_REVIEW" })]);
    expect((await SUBMIT_PROOF(proofRequest({ evidence: ["ev-1"] }))).status).toBe(400);
    expect(db.milestoneProof.create).not.toHaveBeenCalled();
  });

  it("neither a file nor evidence is still a 400", async () => {
    expect((await SUBMIT_PROOF(proofRequest({}))).status).toBe(400);
  });

  it("the pre-review PROOF_SUBMITTED feed event carries no media — donors must not see unreviewed photos", async () => {
    await SUBMIT_PROOF(proofRequest({ withFile: true }));
    const event = (emitProjectImpactEvent as any).mock.calls[0][0];
    expect(event.type).toBe("PROOF_SUBMITTED");
    expect(event.payload).not.toHaveProperty("mediaUrls");
  });

  it("a plain file upload still works with no evidence attached", async () => {
    expect((await SUBMIT_PROOF(proofRequest({ withFile: true }))).status).toBe(200);
    expect(db.milestoneProof.create.mock.calls[0][0].data.fieldEvidenceIds).toEqual([]);
  });
});

describe("GET /api/ngo/milestones/[id]/field-evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue({ user: { id: "owner-a", role: "NGO" } });
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-a" });
    db.fieldEvidence.findMany.mockResolvedValue([
      { id: "ev-1", note: "Projector running", capturedAt: new Date("2026-10-01"), containsPeople: false, task: { title: "Photograph projectors" } },
    ]);
  });

  it("lists approved evidence for the caller's own milestone, scoped by NGO and project", async () => {
    db.milestone.findUnique.mockResolvedValue({ id: "ms-a", projectId: "proj-a", project: { ngoId: "ngo-a" } });
    const res = await LIST(new Request("http://localhost"), { params: { id: "ms-a" } });
    expect(res.status).toBe(200);
    expect((await res.json()).evidence[0]).toMatchObject({ id: "ev-1", taskTitle: "Photograph projectors" });
    expect(db.fieldEvidence.findMany.mock.calls[0][0].where).toMatchObject({ ngoId: "ngo-a", projectId: "proj-a", status: "APPROVED" });
  });

  it("tenant isolation: another NGO's milestone is 404 and nothing is listed", async () => {
    db.milestone.findUnique.mockResolvedValue({ id: "ms-b", projectId: "proj-b", project: { ngoId: "ngo-b" } });
    expect((await LIST(new Request("http://localhost"), { params: { id: "ms-b" } })).status).toBe(404);
    expect(db.fieldEvidence.findMany).not.toHaveBeenCalled();
  });
});
