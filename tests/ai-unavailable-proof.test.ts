import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AI-010: a model failure during milestone-proof submission must not cost the
 * NGO its submission, must not 500, and must not invent a score. The proof is
 * saved with no AI score and an explicit "AI unavailable — human review
 * required" marker; the risk check that judges a score is skipped.
 */

vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    milestone: { findUnique: vi.fn(), update: vi.fn() },
    milestoneProof: { create: vi.fn(), findMany: vi.fn() },
    fieldEvidence: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ uploadFile: vi.fn().mockResolvedValue("/uploads/proofs/x/a.jpg") }));
vi.mock("@/lib/ngo-health", () => ({ recalculateNGOHealthScore: vi.fn() }));
vi.mock("@/lib/impact-events", () => ({ emitProjectImpactEvent: vi.fn() }));
vi.mock("@/lib/risk-agent", () => ({ checkGeminiScore: vi.fn() }));
vi.mock("@/lib/fraud-alerts", () => ({ createFraudAlert: vi.fn() }));
vi.mock("@/lib/gemini/validate-proof", () => ({ validateMilestoneProof: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { checkGeminiScore } from "@/lib/risk-agent";
import { validateMilestoneProof } from "@/lib/gemini/validate-proof";
import { AiUnavailableError, AI_UNAVAILABLE_MESSAGE } from "@/lib/ai/telemetry";
import { POST as SUBMIT_PROOF } from "@/app/api/ngo/submit-proof/route";

const db = prisma as any;

function proofRequest() {
  const form = new FormData();
  form.append("milestoneId", "ms_a");
  form.append("description", "Distributed 40 hygiene kits in Ward 3.");
  form.append("file", new File([new Uint8Array([1, 2, 3])], "proof.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  (getServerSession as any).mockResolvedValue({ user: { id: "user_a", role: "NGO" } });
  db.user.findUnique.mockResolvedValue({ id: "user_a", ngoProfile: { id: "ngo_a", verificationStatus: "VERIFIED", isSuspended: false } });
  db.milestone.findUnique.mockResolvedValue({
    id: "ms_a", title: "Kits", description: "d", targetAmount: 1000, deadline: new Date("2026-12-01"), status: "PENDING", projectId: "proj_a",
    project: { ngoId: "ngo_a", problem_statement: null, expected_outcome: null, latitude: null, longitude: null },
  });
  db.milestoneProof.create.mockResolvedValue({ id: "proof_new" });
  db.milestoneProof.findMany.mockResolvedValue([]);
});

describe.each([
  ["an injected timeout", new AiUnavailableError("TIMEOUT", "validate-proof", true)],
  ["a provider outage", Object.assign(new Error("503 Service Unavailable"), { status: 503 })],
])("proof submission when the model fails (%s)", (_label, failure) => {
  it("saves the proof for human review with no score — 200, not 500", async () => {
    (validateMilestoneProof as any).mockRejectedValue(failure);
    const res = await SUBMIT_PROOF(proofRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, score: null, aiStatus: "AI_UNAVAILABLE", humanReviewRequired: true, reasoning: AI_UNAVAILABLE_MESSAGE });

    const data = db.milestoneProof.create.mock.calls[0][0].data;
    expect(data.aiValidationScore).toBeNull();
    expect(JSON.parse(data.aiValidationResult)).toEqual({ aiUnavailable: true, humanReviewRequired: true, message: AI_UNAVAILABLE_MESSAGE });
    expect(checkGeminiScore).not.toHaveBeenCalled();
  });
});

it("a working model still stores its score", async () => {
  (validateMilestoneProof as any).mockResolvedValue({ score: 82, reasoning: "r", flags: [], tocStrengths: [], tocGaps: [], budgetStatus: "ALIGNED", budgetClaimedAmount: null, budgetReasoning: "" });
  const res = await SUBMIT_PROOF(proofRequest());
  expect((await res.json()).aiStatus).toBe("OK");
  expect(db.milestoneProof.create.mock.calls[0][0].data.aiValidationScore).toBe(82);
  expect(checkGeminiScore).toHaveBeenCalledWith("ms_a", 82);
});
