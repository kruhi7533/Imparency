import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    matchCandidate: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/admin-log", () => ({ logAdminAction: vi.fn(), requestMeta: vi.fn(() => ({})) }));
vi.mock("@/lib/inquiry-thread", () => ({ openNgoInquiryThread: vi.fn() }));
vi.mock("@/lib/matching/notify", async (importOriginal) => ({
  // Keep the real message builders — their wording is asserted below — but
  // stub the funder send, which reaches into Prisma.
  ...(await importOriginal<typeof import("@/lib/matching/notify")>()),
  notifyFunderOfShortlist: vi.fn(),
}));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { logAdminAction } from "@/lib/admin-log";
import { openNgoInquiryThread } from "@/lib/inquiry-thread";
import { notifyFunderOfShortlist } from "@/lib/matching/notify";
import { POST } from "@/app/api/admin/matching/candidates/[candidateId]/decision/route";

const db = prisma as any;
const session = getServerSession as any;
const logMock = logAdminAction as any;
const notifyMock = openNgoInquiryThread as any;
const funderMock = notifyFunderOfShortlist as any;

/**
 * What these tests protect.
 *
 * The shortlist is the one place a human decision enters the matching path, so
 * it carries the same guarantees as every other approval gate in this codebase:
 *
 *  1. Only an ADMIN can decide.
 *  2. A decision is a compare-and-swap on PROPOSED, so two admins acting at
 *     once cannot both "win" and the second gets a 409 rather than a silent
 *     overwrite.
 *  3. Overriding the engine is allowed but never silent — shortlisting an
 *     organisation it did not find eligible requires a written reason, exactly
 *     as review-project requires one when overriding the AI.
 *  4. The audit log carries ids and codes, never names or prose.
 */

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand_1",
    jobId: "job_1",
    ngoId: "ngo_1",
    verdict: "ELIGIBLE",
    decision: "PROPOSED",
    reasons: [
      { code: "VERIFIED_STATUS", label: "Verified organisation", outcome: "PASS", detail: "…", required: true },
    ],
    ngo: { orgName: "Kiran Welfare Society" },
    job: {
      opportunityId: "opp_1",
      opportunity: {
        title: "Sishu Shiksha Grant 2026",
        funderName: "Tata Trusts",
        funderUserId: null,
      },
    },
    ...overrides,
  };
}

/** A candidate whose opportunity has a reachable funder account behind it. */
function withFunder(overrides: Record<string, unknown> = {}) {
  return candidate({
    job: {
      opportunityId: "opp_1",
      opportunity: {
        title: "Sishu Shiksha Grant 2026",
        funderName: "Tata Trusts",
        funderUserId: "funder_1",
      },
    },
    ...overrides,
  });
}

function req(body: Record<string, unknown>) {
  return new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
}

const ctx = { params: { candidateId: "cand_1" } };

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.matchCandidate.findUnique.mockResolvedValue(candidate());
  db.matchCandidate.updateMany.mockResolvedValue({ count: 1 });
  notifyMock.mockResolvedValue("thread_1");
  funderMock.mockResolvedValue("funder_thread_1");
});

describe("who may decide", () => {
  it("refuses an unauthenticated caller and writes nothing", async () => {
    session.mockResolvedValue(null);
    const res = await POST(req({ action: "SHORTLIST" }), ctx);
    expect(res.status).toBe(401);
    expect(db.matchCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an NGO caller and writes nothing", async () => {
    session.mockResolvedValue({ user: { id: "ngo_user", role: "NGO" } });
    const res = await POST(req({ action: "SHORTLIST" }), ctx);
    expect(res.status).toBe(403);
    expect(db.matchCandidate.updateMany).not.toHaveBeenCalled();
  });
});

describe("the decision state machine", () => {
  it("shortlists via compare-and-swap on PROPOSED", async () => {
    const res = await POST(req({ action: "SHORTLIST" }), ctx);

    expect(res.status).toBe(200);
    const call = db.matchCandidate.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "cand_1", decision: "PROPOSED" });
    expect(call.data.decision).toBe("SHORTLISTED");
    expect(call.data.decidedById).toBe("admin_1");
  });

  it("returns 409 when the candidate was already decided", async () => {
    db.matchCandidate.updateMany.mockResolvedValue({ count: 0 });
    db.matchCandidate.findUnique.mockResolvedValue(candidate({ decision: "SHORTLISTED" }));

    const res = await POST(req({ action: "SHORTLIST" }), ctx);
    expect(res.status).toBe(409);
  });

  it("rejects an unknown action", async () => {
    const res = await POST(req({ action: "MAYBE" }), ctx);
    expect(res.status).toBe(400);
    expect(db.matchCandidate.updateMany).not.toHaveBeenCalled();
  });
});

describe("overriding the engine is allowed, but never silent", () => {
  it("refuses to shortlist an INELIGIBLE candidate with no reason given", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(
      candidate({
        verdict: "INELIGIBLE",
        reasons: [
          { code: "COMPLIANCE_FLAG_80G", label: "80G", outcome: "FAIL", detail: "…", required: true },
          { code: "CAUSE_CATEGORY", label: "Cause area", outcome: "FAIL", detail: "…", required: true },
        ],
      })
    );

    const res = await POST(req({ action: "SHORTLIST" }), ctx);

    expect(res.status).toBe(400);
    expect(db.matchCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("allows the override with a reason, and records it as an override", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(
      candidate({
        verdict: "INELIGIBLE",
        reasons: [
          { code: "COMPLIANCE_FLAG_80G", label: "80G", outcome: "FAIL", detail: "…", required: true },
        ],
      })
    );

    const res = await POST(req({ action: "SHORTLIST", note: "80G renewal is in progress; funder accepts." }), ctx);

    expect(res.status).toBe(200);
    const logged = logMock.mock.calls[0][0];
    expect(logged.metadata.overrodeEngine).toBe(true);
    expect(logged.metadata.failedCodes).toEqual(["COMPLIANCE_FLAG_80G"]);
  });

  it("needs no reason to dismiss, whatever the verdict", async () => {
    const res = await POST(req({ action: "DISMISS" }), ctx);
    expect(res.status).toBe(200);
    expect(logMock.mock.calls[0][0].metadata.overrodeEngine).toBe(false);
  });
});

describe("telling the organisation", () => {
  it("notifies a shortlisted organisation and returns the thread id", async () => {
    const res = await POST(req({ action: "SHORTLIST" }), ctx);
    const body = await res.json();

    expect(notifyMock).toHaveBeenCalledTimes(1);
    const sent = notifyMock.mock.calls[0][0];
    expect(sent.ngoId).toBe("ngo_1");
    expect(sent.subject).toContain("Sishu Shiksha Grant 2026");
    expect(sent.entityType).toBe("OPPORTUNITY");
    expect(sent.entityId).toBe("opp_1");
    expect(body.notifiedThreadId).toBe("thread_1");
  });

  it("does not overstate the outcome — the message says it is not an award", async () => {
    await POST(req({ action: "SHORTLIST" }), ctx);
    const sent = notifyMock.mock.calls[0][0];
    expect(sent.body).toMatch(/not an award/i);
    expect(sent.body).toMatch(/not a commitment of funds/i);
  });

  it("stays silent on a dismissal — there is no appeal path to point it at", async () => {
    await POST(req({ action: "DISMISS" }), ctx);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("keeps the decision when notification fails, and says it was not sent", async () => {
    notifyMock.mockRejectedValue(new Error("smtp unreachable"));

    const res = await POST(req({ action: "SHORTLIST" }), ctx);
    const body = await res.json();

    // The shortlist is recorded regardless — a dead mail provider must not
    // silently undo an admin's decision.
    expect(res.status).toBe(200);
    expect(db.matchCandidate.updateMany).toHaveBeenCalled();
    // ...but the admin is told the organisation was not reached.
    expect(body.notifiedThreadId).toBeNull();
  });
});

describe("telling the funder", () => {
  it("notifies the funder when their opportunity has a linked account", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(withFunder());

    const res = await POST(req({ action: "SHORTLIST" }), ctx);

    expect(res.status).toBe(200);
    expect(funderMock).toHaveBeenCalledTimes(1);
    const sent = funderMock.mock.calls[0][0];
    expect(sent.funderUserId).toBe("funder_1");
    expect(sent.ngoName).toBe("Kiran Welfare Society");
    expect(sent.opportunityId).toBe("opp_1");
  });

  it("says nothing to an offline funder — funderName is only a label", async () => {
    await POST(req({ action: "SHORTLIST" }), ctx);
    expect(funderMock).not.toHaveBeenCalled();
  });

  it("does not tell the funder about a dismissal", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(withFunder());
    await POST(req({ action: "DISMISS" }), ctx);
    expect(funderMock).not.toHaveBeenCalled();
  });

  it("keeps the decision and still reaches the NGO when the funder send fails", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(withFunder());
    funderMock.mockRejectedValue(new Error("smtp unreachable"));

    const res = await POST(req({ action: "SHORTLIST" }), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(db.matchCandidate.updateMany).toHaveBeenCalled();
    // The organisation's own notification is independent of the funder's.
    expect(body.notifiedThreadId).toBe("thread_1");
  });
});

describe("audit privacy", () => {
  it("logs ids and codes only — no organisation name, no reason prose", async () => {
    await POST(req({ action: "SHORTLIST" }), ctx);

    const logged = logMock.mock.calls[0][0];
    expect(logged.entityType).toBe("MATCH_CANDIDATE");
    expect(logged.metadata).toEqual({
      jobId: "job_1",
      ngoId: "ngo_1",
      verdict: "ELIGIBLE",
      failedCodes: [],
      overrodeEngine: false,
    });
    // The full reason objects carry prose; they must not reach the audit trail.
    expect(JSON.stringify(logged.metadata)).not.toContain("detail");
  });
});
