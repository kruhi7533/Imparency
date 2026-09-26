import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Cross-tenant isolation — the invariant that org A can never reach org B's rows.
 *
 * `verifySessionRole("NGO")` proves the caller is *an* NGO. It never proves the
 * caller owns the row being touched. Every route reaching an org-owned record
 * has to check ownership itself, and today each one spells that check
 * differently:
 *
 *   projects/[id]              project.ngoId !== profile.id            -> 403
 *   projects/[id]/geo-enrich   project.ngo.userId !== session.user.id  -> 403
 *   threads/[id]/reply         thread.subjectId !== ngoId              -> 404
 *   inquiries/[threadId]/reply thread.ngoId !== ngoId                  -> 403
 *   submit-proof               milestone.project.ngoId !== profile.id  -> 404
 *
 * Six spellings of one rule means a route that omits it does not look wrong in
 * review. These tests pin the behaviour so the idioms can later be collapsed
 * into one helper without changing what the routes actually do.
 *
 * On 403 vs 404: two routes deliberately answer "not found" rather than
 * "forbidden" so an attacker cannot use the status code to confirm that a
 * milestone or thread id exists. That is intentional, so these tests assert
 * what each route really does rather than forcing a single convention.
 *
 * Where the denial message is unique to the ownership branch, asserting the
 * message is enough. Where the route deliberately collapses "not yours" and
 * "does not exist" into one response, a positive control runs the identical
 * fixture with a matching ngoId — proving the denial came from the ownership
 * check and not from a mock that simply returned nothing.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    reviewThread: { findUnique: vi.fn(), update: vi.fn() },
    reviewMessage: { create: vi.fn() },
    donorInquiry: { findUnique: vi.fn(), update: vi.fn() },
    donorInquiryMessage: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    milestone: { findUnique: vi.fn(), update: vi.fn() },
    milestoneProof: { create: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
  },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

// Side-effect collaborators on the happy path. Mocked so a positive control
// exercises the ownership gate without uploading a file or calling a model.
vi.mock("@/lib/notify-admin-thread", () => ({ notifyAdminsOfNgoThreadActivity: vi.fn() }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn().mockResolvedValue("https://cdn.test/proof.jpg") }));
vi.mock("@/lib/ngo-health", () => ({ recalculateNGOHealthScore: vi.fn() }));
vi.mock("@/lib/gemini/validate-proof", () => ({
  validateMilestoneProof: vi.fn().mockResolvedValue({
    score: 80,
    tocAlignmentScore: 70,
    tocReasoning: "n/a",
    tocStrengths: [],
    tocGaps: [],
  }),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { PATCH as PROJECT_PATCH } from "@/app/api/ngo/projects/[id]/route";
import { POST as THREAD_REPLY } from "@/app/api/ngo/threads/[id]/reply/route";
import { POST as INQUIRY_REPLY } from "@/app/api/ngo/inquiries/[threadId]/reply/route";
import { POST as SUBMIT_PROOF } from "@/app/api/ngo/submit-proof/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;

/** Org A is the caller throughout. Org B owns every row under test. */
const ORG_A = { userId: "user_a", ngoId: "ngo_a" };
const ORG_B = { ngoId: "ngo_b" };

function signInAsOrgA() {
  getSessionMock.mockResolvedValue({ user: { id: ORG_A.userId, role: "NGO" } });
  prismaMock.nGOProfile.findUnique.mockResolvedValue({
    id: ORG_A.ngoId,
    verificationStatus: "VERIFIED",
  });
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
}

/** submit-proof reads formData before it checks ownership, so it needs a real one. */
function proofRequest(milestoneId: string) {
  const form = new FormData();
  form.append("milestoneId", milestoneId);
  form.append("description", "Distributed 40 hygiene kits in Ward 3.");
  form.append("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost", { method: "POST", body: form });
}

describe("cross-tenant isolation: org A must not reach org B's rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInAsOrgA();
  });

  describe("PATCH /api/ngo/projects/[id]", () => {
    it("denies editing another org's project with 403", async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        id: "proj_b",
        ngoId: ORG_B.ngoId,
        isDeleted: false,
        raisedAmount: 0,
        milestones: [],
      });

      const res = await PROJECT_PATCH(new Request("http://localhost", { method: "PATCH" }), {
        params: { id: "proj_b" },
      });

      expect(res.status).toBe(403);
      // Message is unique to the ownership branch — a 403 from the
      // verification-status gate above it reads "Only verified NGOs can edit".
      expect((await res.json()).error).toBe("Unauthorized access to project");
    });
  });

  describe("POST /api/ngo/threads/[id]/reply", () => {
    it("denies replying to another org's thread", async () => {
      prismaMock.nGOProfile.findUnique.mockResolvedValue({ id: ORG_A.ngoId });
      prismaMock.reviewThread.findUnique.mockResolvedValue({
        id: "thread_b",
        subjectType: "NGO",
        subjectId: ORG_B.ngoId,
        status: "OPEN",
      });

      const res = await THREAD_REPLY(jsonRequest({ message: "let me in" }), {
        params: { id: "thread_b" },
      });

      // 404, not 403 — the route refuses to confirm the thread exists.
      expect(res.status).toBe(404);
      expect(prismaMock.reviewMessage.create).not.toHaveBeenCalled();
    });

    it("positive control: the same thread owned by org A is accepted", async () => {
      prismaMock.nGOProfile.findUnique.mockResolvedValue({ id: ORG_A.ngoId });
      prismaMock.reviewThread.findUnique.mockResolvedValue({
        id: "thread_a",
        subjectType: "NGO",
        subjectId: ORG_A.ngoId,
        status: "OPEN",
      });

      const res = await THREAD_REPLY(jsonRequest({ message: "here is the document" }), {
        params: { id: "thread_a" },
      });

      // Proves the 404 above came from the ownership check, not an empty mock.
      expect(res.status).toBe(200);
      expect(prismaMock.reviewMessage.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/ngo/inquiries/[threadId]/reply", () => {
    it("denies replying to another org's donor inquiry with 403", async () => {
      prismaMock.nGOProfile.findUnique.mockResolvedValue({ id: ORG_A.ngoId });
      prismaMock.donorInquiry.findUnique.mockResolvedValue({
        id: "inq_b",
        ngoId: ORG_B.ngoId,
        donor: { id: "donor_1" },
        ngo: { id: ORG_B.ngoId },
      });

      const res = await INQUIRY_REPLY(jsonRequest({ body: "who is asking?" }), {
        params: { threadId: "inq_b" },
      });

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("Forbidden: Thread belongs to another NGO");
      expect(prismaMock.donorInquiryMessage.create).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/ngo/submit-proof", () => {
    it("denies submitting proof against another org's milestone", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: ORG_A.userId,
        ngoProfile: { id: ORG_A.ngoId, verificationStatus: "VERIFIED", isSuspended: false },
      });
      prismaMock.milestone.findUnique.mockResolvedValue({
        id: "ms_b",
        title: "Kit distribution",
        description: "d",
        targetAmount: 1000,
        deadline: new Date("2026-12-01"),
        status: "PENDING",
        projectId: "proj_b",
        project: { ngoId: ORG_B.ngoId, problem_statement: null, expected_outcome: null },
      });

      const res = await SUBMIT_PROOF(proofRequest("ms_b"));

      // 404 by design — does not confirm the milestone id exists.
      expect(res.status).toBe(404);
      expect(prismaMock.milestoneProof.create).not.toHaveBeenCalled();
    });

    it("positive control: the same milestone owned by org A is accepted", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: ORG_A.userId,
        ngoProfile: { id: ORG_A.ngoId, verificationStatus: "VERIFIED", isSuspended: false },
      });
      prismaMock.milestone.findUnique.mockResolvedValue({
        id: "ms_a",
        title: "Kit distribution",
        description: "d",
        targetAmount: 1000,
        deadline: new Date("2026-12-01"),
        status: "PENDING",
        projectId: "proj_a",
        project: { ngoId: ORG_A.ngoId, problem_statement: null, expected_outcome: null },
      });
      prismaMock.milestoneProof.create.mockResolvedValue({ id: "proof_1" });

      const res = await SUBMIT_PROOF(proofRequest("ms_a"));

      expect(res.status).toBe(200);
      expect(prismaMock.milestoneProof.create).toHaveBeenCalledTimes(1);
    });
  });
});
