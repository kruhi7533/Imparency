import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/ngo/submit-proof — the duplicate-evidence side effect.
 *
 * lib/proof-fingerprint.ts owns the verdict table and is tested directly in
 * tests/proof-fingerprint.test.ts. What is tested HERE is the wiring that the
 * pure function cannot see:
 *
 *   - the hashes actually reach the stored row (an empty `contentHashes` reads
 *     as "not fingerprinted", so a submission that silently stored nothing
 *     would make every future check miss it);
 *   - the collision lookup runs BEFORE the row is created, so a submission
 *     cannot match itself and flag every proof as its own duplicate;
 *   - a resubmission raises no alert, and a cross-project hit raises a HIGH one;
 *   - the check is best-effort: a failing lookup must not cost an NGO its
 *     submission, the same contract the GPS read has.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    milestone: { findUnique: vi.fn(), update: vi.fn() },
    milestoneProof: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn().mockResolvedValue("/uploads/proofs/x/a.jpg") }));
vi.mock("@/lib/ngo-health", () => ({ recalculateNGOHealthScore: vi.fn() }));
vi.mock("@/lib/impact-events", () => ({ emitProjectImpactEvent: vi.fn() }));
vi.mock("@/lib/risk-agent", () => ({ checkGeminiScore: vi.fn() }));
vi.mock("@/lib/fraud-alerts", () => ({ createFraudAlert: vi.fn() }));
vi.mock("@/lib/gemini/validate-proof", () => ({
  validateMilestoneProof: vi.fn().mockResolvedValue({
    score: 80,
    reasoning: "r",
    flags: [],
    suggestion: "s",
    tocAlignmentScore: 70,
    tocReasoning: "t",
    tocStrengths: [],
    tocGaps: [],
  }),
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { createFraudAlert } from "@/lib/fraud-alerts";
import { hashBuffer } from "@/lib/proof-fingerprint";
import { POST as SUBMIT_PROOF } from "@/app/api/ngo/submit-proof/route";

const prismaMock = prisma as any;
const getSessionMock = getServerSession as any;
const alertMock = createFraudAlert as any;

const ORG_A = "ngo_a";
const ORG_B = "ngo_b";
const PROJECT_A = "proj_a";
const MILESTONE_A = "ms_a";

/** The exact bytes the request below sends, so the expected hash is derivable. */
const PROOF_BYTES = new Uint8Array([9, 8, 7, 6]);
const EXPECTED_HASH = hashBuffer(Buffer.from(PROOF_BYTES));

function proofRequest() {
  const form = new FormData();
  form.append("milestoneId", MILESTONE_A);
  form.append("description", "Distributed 40 hygiene kits in Ward 3.");
  form.append("file", new File([PROOF_BYTES], "proof.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost", { method: "POST", body: form });
}

/** A prior proof row as the route's own collision query would select it. */
function priorProof(overrides: {
  id?: string;
  milestoneId?: string;
  projectId?: string;
  ngoId?: string;
  title?: string;
}) {
  return {
    id: overrides.id ?? "proof_earlier",
    milestoneId: overrides.milestoneId ?? MILESTONE_A,
    milestone: {
      title: overrides.title ?? "Earlier milestone",
      projectId: overrides.projectId ?? PROJECT_A,
      project: {
        ngoId: overrides.ngoId ?? ORG_A,
        ngo: { orgName: overrides.ngoId === ORG_B ? "Org B" : "Org A" },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  getSessionMock.mockResolvedValue({ user: { id: "user_a", role: "NGO" } });
  prismaMock.user.findUnique.mockResolvedValue({
    id: "user_a",
    ngoProfile: { id: ORG_A, verificationStatus: "VERIFIED", isSuspended: false },
  });
  prismaMock.milestone.findUnique.mockResolvedValue({
    id: MILESTONE_A,
    title: "Kit distribution",
    description: "d",
    targetAmount: 1000,
    deadline: new Date("2026-12-01"),
    status: "PENDING",
    projectId: PROJECT_A,
    project: {
      ngoId: ORG_A,
      problem_statement: null,
      expected_outcome: null,
      latitude: null,
      longitude: null,
    },
  });
  prismaMock.milestoneProof.create.mockResolvedValue({ id: "proof_new" });
  prismaMock.milestoneProof.findMany.mockResolvedValue([]);
});

describe("proof fingerprints are stored", () => {
  it("writes the SHA-256 of each uploaded file onto the proof row", async () => {
    const res = await SUBMIT_PROOF(proofRequest());

    expect(res.status).toBe(200);
    expect(prismaMock.milestoneProof.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.milestoneProof.create.mock.calls[0][0].data.contentHashes).toEqual([
      EXPECTED_HASH,
    ]);
  });

  it("looks for collisions BEFORE creating the row, so a proof cannot match itself", async () => {
    await SUBMIT_PROOF(proofRequest());

    const lookupOrder = prismaMock.milestoneProof.findMany.mock.invocationCallOrder[0];
    const createOrder = prismaMock.milestoneProof.create.mock.invocationCallOrder[0];
    expect(lookupOrder).toBeLessThan(createOrder);

    // And it searches on the hashes of THIS submission, not on everything.
    expect(prismaMock.milestoneProof.findMany.mock.calls[0][0].where).toEqual({
      contentHashes: { hasSome: [EXPECTED_HASH] },
    });
  });
});

describe("duplicate verdicts reaching the alert queue", () => {
  it("raises nothing when no earlier proof shares a file", async () => {
    await SUBMIT_PROOF(proofRequest());
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("raises nothing for a resubmission against the same milestone", async () => {
    // The common honest case: re-uploading after a rejection. An alert here
    // would train admins to ignore PROOF_DUPLICATE_MEDIA.
    prismaMock.milestoneProof.findMany.mockResolvedValue([priorProof({})]);

    const res = await SUBMIT_PROOF(proofRequest());

    expect(res.status).toBe(200);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("raises a MEDIUM alert when the file was already used on another milestone of the same project", async () => {
    prismaMock.milestoneProof.findMany.mockResolvedValue([
      priorProof({ id: "proof_ms2", milestoneId: "ms_b", title: "Site survey" }),
    ]);

    await SUBMIT_PROOF(proofRequest());

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [type, entityId, entityType, description, severity] = alertMock.mock.calls[0];
    expect(type).toBe("PROOF_DUPLICATE_MEDIA");
    expect(entityId).toBe(MILESTONE_A);
    expect(entityType).toBe("NGO");
    expect(severity).toBe("MEDIUM");
    expect(description).toContain("proof_ms2");
  });

  it("raises a HIGH alert when another organisation already submitted the same file", async () => {
    prismaMock.milestoneProof.findMany.mockResolvedValue([
      priorProof({
        id: "proof_orgb",
        milestoneId: "ms_x",
        projectId: "proj_b",
        ngoId: ORG_B,
        title: "Borewell handover",
      }),
    ]);

    await SUBMIT_PROOF(proofRequest());

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [, , , description, severity] = alertMock.mock.calls[0];
    expect(severity).toBe("HIGH");
    expect(description).toContain("Org B");
    expect(description).toContain("proof_orgb");
  });

  it("raises one alert per submission, with a stable description, so a replay dedupes instead of stacking", async () => {
    // createFraudAlert dedupes on (type, entityId, description, resolved) —
    // that only works if resubmitting the identical files produces the
    // identical description. Two submissions, two calls, one dedupe key.
    prismaMock.milestoneProof.findMany.mockResolvedValue([
      priorProof({ id: "proof_ms2", milestoneId: "ms_b", title: "Site survey" }),
    ]);

    await SUBMIT_PROOF(proofRequest());
    await SUBMIT_PROOF(proofRequest());

    expect(alertMock).toHaveBeenCalledTimes(2);
    expect(alertMock.mock.calls[0][3]).toBe(alertMock.mock.calls[1][3]);
  });
});

describe("the check is best-effort", () => {
  it("still accepts the submission when the collision lookup fails", async () => {
    // Same contract as the GPS read: a provenance check that can reject an
    // NGO's evidence because of an infrastructure hiccup is worse than one
    // that occasionally misses.
    prismaMock.milestoneProof.findMany.mockRejectedValue(new Error("connection reset"));

    const res = await SUBMIT_PROOF(proofRequest());

    expect(res.status).toBe(200);
    expect(prismaMock.milestoneProof.create).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("still stores the hashes when the lookup fails, so the NEXT submission can collide with this one", async () => {
    prismaMock.milestoneProof.findMany.mockRejectedValue(new Error("connection reset"));

    await SUBMIT_PROOF(proofRequest());

    expect(prismaMock.milestoneProof.create.mock.calls[0][0].data.contentHashes).toEqual([
      EXPECTED_HASH,
    ]);
  });
});
