import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The outcome-claim routes: filing, submitting, and an admin deciding.
 *
 * Three properties are pinned here, and each is a thing no pure-function test
 * can reach because it lives in the route:
 *
 *  1. **Tenant isolation.** An organisation cannot file a claim on another's
 *     project, cannot cite another's evidence, and cannot see another's claim.
 *     Role is not ownership (CLAUDE.md) — `verifySessionRole("NGO")` proves
 *     only that the caller is *an* NGO.
 *  2. **The approval gate is in the route.** A BLOCKED triage verdict is
 *     refused with 422 no matter what the client sends. Hiding the button
 *     would leave the hole open to any PATCH.
 *  3. **Self-approval is impossible.** An NGO session is refused the admin
 *     actions explicitly, not merely by living on a different path.
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    milestone: { findUnique: vi.fn() },
    metricDefinition: { findUnique: vi.fn() },
    milestoneProof: { findMany: vi.fn(async () => []) },
    fieldEvidence: { findMany: vi.fn(async () => []) },
    beneficiaryFeedback: { findMany: vi.fn(async () => []) },
    outcomeClaim: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    outcomeClaimEvidence: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { POST as FILE_CLAIM } from "@/app/api/ngo/outcome-claims/route";
import { PATCH as NGO_PATCH } from "@/app/api/ngo/outcome-claims/[id]/route";
import { PATCH as ADMIN_PATCH } from "@/app/api/admin/outcome-claims/[id]/route";

const db = prisma as any;
const session = getServerSession as any;
const audit = logAdminAction as any;

const NGO_ID = "ngo_1";
const OTHER_NGO_ID = "ngo_2";
const NGO_USER = "user_ngo";
const ADMIN_USER = "user_admin";
const PROJECT_ID = "proj_1";
const CLAIM_ID = "claim_1";
const METHOD = "Attendance registers from each of the three centres, de-duplicated by name.";

const ACTIVE_METRIC = {
  code: "IB-TRAINED-001",
  unit: "COUNT_PEOPLE",
  status: "ACTIVE",
  requiredEvidence: ["MILESTONE_PROOF"],
};

function req(url: string, body: unknown, method = "PATCH") {
  return new Request(url, { method, body: JSON.stringify(body) }) as any;
}

function asNgo() {
  session.mockResolvedValue({ user: { id: NGO_USER, role: "NGO" } });
  db.nGOProfile.findUnique.mockResolvedValue({ id: NGO_ID, verificationStatus: "VERIFIED" });
}
function asAdmin() {
  session.mockResolvedValue({ user: { id: ADMIN_USER, role: "ADMIN" } });
}

/** A claim row as the admin route selects it. */
function claimRow(over: Record<string, unknown> = {}) {
  return {
    id: CLAIM_ID,
    status: "SUBMITTED",
    value: { toString: () => "2" },
    unit: "COUNT_PEOPLE",
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-30"),
    metricCode: ACTIVE_METRIC.code,
    metric: ACTIVE_METRIC,
    citations: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.milestoneProof.findMany.mockResolvedValue([]);
  db.fieldEvidence.findMany.mockResolvedValue([]);
  db.beneficiaryFeedback.findMany.mockResolvedValue([]);
  db.outcomeClaimEvidence.findMany.mockResolvedValue([]);
  db.outcomeClaim.updateMany.mockResolvedValue({ count: 1 });
});

describe("filing a claim — tenant isolation", () => {
  const validBody = {
    metricCode: ACTIVE_METRIC.code,
    projectId: PROJECT_ID,
    value: "40",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    method: METHOD,
    citations: [],
  };

  it("refuses a claim on another organisation's project", async () => {
    asNgo();
    db.metricDefinition.findUnique.mockResolvedValue(ACTIVE_METRIC);
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, ngoId: OTHER_NGO_ID, isDeleted: false });

    const res = await FILE_CLAIM(req("http://localhost/api/ngo/outcome-claims", validBody, "POST"));
    expect(res.status).toBe(403);
    expect(db.outcomeClaim.create).not.toHaveBeenCalled();
  });

  it("refuses a citation belonging to another organisation", async () => {
    asNgo();
    db.metricDefinition.findUnique.mockResolvedValue(ACTIVE_METRIC);
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, ngoId: NGO_ID, isDeleted: false });
    // The photo exists, but it is someone else's.
    db.fieldEvidence.findMany.mockResolvedValue([{ id: "ev_1", ngoId: OTHER_NGO_ID }]);

    const res = await FILE_CLAIM(
      req(
        "http://localhost/api/ngo/outcome-claims",
        { ...validBody, citations: [{ kind: "FIELD_PHOTO", id: "ev_1" }] },
        "POST"
      )
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("another organisation");
    expect(db.outcomeClaim.create).not.toHaveBeenCalled();
  });

  it("refuses a milestone that is not on the named project", async () => {
    asNgo();
    db.metricDefinition.findUnique.mockResolvedValue(ACTIVE_METRIC);
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, ngoId: NGO_ID, isDeleted: false });
    db.milestone.findUnique.mockResolvedValue({ id: "ms_x", projectId: "some_other_project" });

    const res = await FILE_CLAIM(
      req("http://localhost/api/ngo/outcome-claims", { ...validBody, milestoneId: "ms_x" }, "POST")
    );
    expect(res.status).toBe(400);
    expect(db.outcomeClaim.create).not.toHaveBeenCalled();
  });

  it("refuses a claim against a metric that is not ACTIVE", async () => {
    asNgo();
    db.metricDefinition.findUnique.mockResolvedValue({ ...ACTIVE_METRIC, status: "DEPRECATED" });

    const res = await FILE_CLAIM(req("http://localhost/api/ngo/outcome-claims", validBody, "POST"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("deprecated");
  });

  it("files into DRAFT and snapshots the metric's unit", async () => {
    asNgo();
    db.metricDefinition.findUnique.mockResolvedValue(ACTIVE_METRIC);
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, ngoId: NGO_ID, isDeleted: false });
    db.outcomeClaim.create.mockResolvedValue({ id: CLAIM_ID, status: "DRAFT" });

    const res = await FILE_CLAIM(req("http://localhost/api/ngo/outcome-claims", validBody, "POST"));
    expect(res.status).toBe(201);
    const data = db.outcomeClaim.create.mock.calls[0][0].data;
    expect(data.status).toBe("DRAFT");
    expect(data.unit).toBe("COUNT_PEOPLE");
    // A string, never a float — the value goes into NUMERIC(14,2).
    expect(data.value).toBe("40");
  });

  it.each(["40.123", "-5", "abc", ""])("rejects the value %p", async (value) => {
    asNgo();
    db.metricDefinition.findUnique.mockResolvedValue(ACTIVE_METRIC);
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, ngoId: NGO_ID, isDeleted: false });

    const res = await FILE_CLAIM(
      req("http://localhost/api/ngo/outcome-claims", { ...validBody, value }, "POST")
    );
    expect(res.status).toBe(400);
  });

  it("requires a method — '120' with no account of how is not reviewable", async () => {
    asNgo();
    db.metricDefinition.findUnique.mockResolvedValue(ACTIVE_METRIC);
    db.project.findUnique.mockResolvedValue({ id: PROJECT_ID, ngoId: NGO_ID, isDeleted: false });

    const res = await FILE_CLAIM(
      req("http://localhost/api/ngo/outcome-claims", { ...validBody, method: "counted" }, "POST")
    );
    expect(res.status).toBe(400);
  });
});

describe("the NGO's own actions", () => {
  it("cannot approve its own claim", async () => {
    asNgo();
    const res = await NGO_PATCH(req(`http://localhost/x`, { action: "APPROVE" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("cannot decide its own claim");
    expect(db.outcomeClaim.updateMany).not.toHaveBeenCalled();
  });

  it("gets 404 — not 403 — for another organisation's claim", async () => {
    asNgo();
    // The existence of a claim id is itself information.
    db.outcomeClaim.findUnique.mockResolvedValue({
      id: CLAIM_ID,
      ngoId: OTHER_NGO_ID,
      status: "DRAFT",
      citations: [],
    });
    const res = await NGO_PATCH(req("http://localhost/x", { action: "SUBMIT" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(404);
  });

  it("refuses to submit a claim with no citations", async () => {
    asNgo();
    db.outcomeClaim.findUnique.mockResolvedValue({
      id: CLAIM_ID,
      ngoId: NGO_ID,
      status: "DRAFT",
      citations: [],
    });
    const res = await NGO_PATCH(req("http://localhost/x", { action: "SUBMIT" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(400);
    expect(db.outcomeClaim.updateMany).not.toHaveBeenCalled();
  });

  it("requires a reason to withdraw", async () => {
    asNgo();
    db.outcomeClaim.findUnique.mockResolvedValue({
      id: CLAIM_ID,
      ngoId: NGO_ID,
      status: "APPROVED",
      citations: [{ id: "c1" }],
    });
    const res = await NGO_PATCH(req("http://localhost/x", { action: "WITHDRAW", note: "oops" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(400);
  });

  it("loses a compare-and-swap race with 409", async () => {
    asNgo();
    db.outcomeClaim.findUnique.mockResolvedValue({
      id: CLAIM_ID,
      ngoId: NGO_ID,
      status: "DRAFT",
      citations: [{ id: "c1" }],
    });
    db.outcomeClaim.updateMany.mockResolvedValue({ count: 0 });
    const res = await NGO_PATCH(req("http://localhost/x", { action: "SUBMIT" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(409);
  });
});

describe("the admin decision — the gate", () => {
  it("rejects a non-admin session", async () => {
    session.mockResolvedValue({ user: { id: NGO_USER, role: "NGO" } });
    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "APPROVE" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(403);
  });

  /**
   * The week's load-bearing route behaviour. The claim cites nothing, so
   * triage returns BLOCKED (NO_EVIDENCE_CITED + REQUIRED_KIND_MISSING), and
   * approval must be refused regardless of what the client sent.
   */
  it("refuses to approve a BLOCKED claim with 422", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(claimRow({ citations: [] }));

    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "APPROVE" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.findings.map((f: any) => f.code)).toContain("NO_EVIDENCE_CITED");
    expect(db.outcomeClaim.updateMany).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("allows returning a BLOCKED claim for evidence", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(claimRow({ citations: [] }));

    const res = await ADMIN_PATCH(
      req("http://localhost/x", {
        action: "REQUEST_EVIDENCE",
        note: "Cite the approved milestone proof for the training sessions.",
      }),
      { params: { id: CLAIM_ID } }
    );
    expect(res.status).toBe(200);
    expect(db.outcomeClaim.updateMany).toHaveBeenCalled();
  });

  it("approves a claim whose citations check out", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(
      claimRow({ citations: [{ id: "c1", kind: "MILESTONE_PROOF", proofId: "proof_1", evidenceId: null, feedbackId: null }] })
    );
    // An approved milestone review is what makes a proof count as approved.
    db.milestoneProof.findMany.mockResolvedValue([
      { id: "proof_1", submittedAt: new Date("2026-09-15"), milestone: { reviews: [{ id: "rev_1" }] } },
    ]);

    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "APPROVE" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).triage.verdict).toBe("CLEAN");
  });

  it("blocks approval when the cited proof was never reviewed", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(
      claimRow({ citations: [{ id: "c1", kind: "MILESTONE_PROOF", proofId: "proof_1", evidenceId: null, feedbackId: null }] })
    );
    db.milestoneProof.findMany.mockResolvedValue([
      { id: "proof_1", submittedAt: new Date("2026-09-15"), milestone: { reviews: [] } },
    ]);

    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "APPROVE" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).findings.map((f: any) => f.code)).toContain("EVIDENCE_NOT_APPROVED");
  });

  it("flags double counting but still lets a human approve over it", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(
      claimRow({ citations: [{ id: "c1", kind: "MILESTONE_PROOF", proofId: "proof_1", evidenceId: null, feedbackId: null }] })
    );
    db.milestoneProof.findMany.mockResolvedValue([
      { id: "proof_1", submittedAt: new Date("2026-09-15"), milestone: { reviews: [{ id: "rev_1" }] } },
    ]);
    // Already counted by an approved claim on the SAME metric.
    db.outcomeClaimEvidence.findMany.mockResolvedValue([
      { proofId: "proof_1", evidenceId: null, feedbackId: null },
    ]);

    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "APPROVE" }), {
      params: { id: CLAIM_ID },
    });
    // NEEDS_REVIEW, not BLOCKED: these findings are questions a human may answer.
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.triage.verdict).toBe("NEEDS_REVIEW");
    expect(data.triage.findings.map((f: any) => f.code)).toContain("DOUBLE_COUNTED");
  });

  it("requires a reason to reject", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(claimRow());
    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "REJECT", note: "no" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(400);
    expect(db.outcomeClaim.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an action that belongs to the organisation", async () => {
    asAdmin();
    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "WITHDRAW", note: "a reason here" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(403);
  });

  it("loses a two-admin race with 409", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(
      claimRow({ citations: [{ id: "c1", kind: "MILESTONE_PROOF", proofId: "proof_1", evidenceId: null, feedbackId: null }] })
    );
    db.milestoneProof.findMany.mockResolvedValue([
      { id: "proof_1", submittedAt: new Date("2026-09-15"), milestone: { reviews: [{ id: "rev_1" }] } },
    ]);
    db.outcomeClaim.updateMany.mockResolvedValue({ count: 0 });

    const res = await ADMIN_PATCH(req("http://localhost/x", { action: "APPROVE" }), {
      params: { id: CLAIM_ID },
    });
    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("the audit log carries ids only", () => {
  it("records the verdict and finding codes, never the method text", async () => {
    asAdmin();
    db.outcomeClaim.findUnique.mockResolvedValue(
      claimRow({
        method: METHOD,
        citations: [{ id: "c1", kind: "MILESTONE_PROOF", proofId: "proof_1", evidenceId: null, feedbackId: null }],
      })
    );
    db.milestoneProof.findMany.mockResolvedValue([
      { id: "proof_1", submittedAt: new Date("2026-09-15"), milestone: { reviews: [{ id: "rev_1" }] } },
    ]);

    await ADMIN_PATCH(req("http://localhost/x", { action: "APPROVE" }), { params: { id: CLAIM_ID } });

    expect(audit).toHaveBeenCalledTimes(1);
    const logged = audit.mock.calls[0][0];
    expect(logged.action).toBe("OUTCOME_CLAIM_APPROVED");
    expect(logged.entityType).toBe("OUTCOME_CLAIM");
    expect(logged.entityId).toBe(CLAIM_ID);
    expect(logged.newValue.triageVerdict).toBe("CLEAN");

    // The free text must not be in there. The log outlives PII retention on
    // the main tables, and finding MESSAGES embed evidence ids and counts, so
    // only the CODES are recorded.
    const serialised = JSON.stringify(logged);
    expect(serialised).not.toContain("Attendance registers");
    expect(serialised).not.toContain("@");
  });
});
