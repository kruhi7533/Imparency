import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    matchCandidate: { findUnique: vi.fn() },
    reviewThread: { findFirst: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/inquiry-thread", () => ({ openNgoInquiryThread: vi.fn() }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { openNgoInquiryThread } from "@/lib/inquiry-thread";
import { buildShortlistMessage } from "@/lib/matching/notify";
import { POST } from "@/app/api/admin/matching/candidates/[candidateId]/notify/route";

const db = prisma as any;
const session = getServerSession as any;
const notifyMock = openNgoInquiryThread as any;

/**
 * What these tests protect.
 *
 * This is the repair path for a shortlist the organisation was never told
 * about. Two things must hold: only a shortlisting is announceable, and it is
 * announced at most once — "you have been shortlisted" arriving twice reads as
 * a second opportunity, not as a harmless retry.
 *
 * The message tests pin wording that carries obligations. The platform verifies
 * organisations thoroughly and funders not at all, so the message has to say so
 * rather than let ImpactBridge's credibility silently vouch for a name an admin
 * typed into a text box.
 */

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand_1",
    ngoId: "ngo_1",
    decision: "SHORTLISTED",
    decisionNote: null,
    job: {
      opportunityId: "opp_1",
      opportunity: { title: "Sishu Shiksha Grant 2026", funderName: "Tata Trusts" },
    },
    ...overrides,
  };
}

const ctx = { params: { candidateId: "cand_1" } };
const req = () => new Request("http://localhost", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  db.matchCandidate.findUnique.mockResolvedValue(candidate());
  db.reviewThread.findFirst.mockResolvedValue(null);
  notifyMock.mockResolvedValue("thread_9");
});

describe("who may notify", () => {
  it("refuses an unauthenticated caller and sends nothing", async () => {
    session.mockResolvedValue(null);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("refuses an NGO caller and sends nothing", async () => {
    session.mockResolvedValue({ user: { id: "u", role: "NGO" } });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("what may be announced", () => {
  it("notifies a shortlisted organisation that was never told", async () => {
    const res = await POST(req(), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifiedThreadId).toBe("thread_9");
    expect(notifyMock.mock.calls[0][0].entityId).toBe("opp_1");
  });

  it("refuses to announce a dismissal", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(candidate({ decision: "DISMISSED" }));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("refuses to announce a candidate nobody has decided yet", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(candidate({ decision: "PROPOSED" }));
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("never sends a second copy", async () => {
    db.reviewThread.findFirst.mockResolvedValue({ id: "thread_existing" });

    const res = await POST(req(), ctx);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.threadId).toBe("thread_existing");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("404s an unknown candidate", async () => {
    db.matchCandidate.findUnique.mockResolvedValue(null);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
  });
});

describe("the message itself", () => {
  const message = buildShortlistMessage({
    opportunityTitle: "Sishu Shiksha Grant 2026",
    funderName: "Tata Trusts",
  });

  it("does not read as an award", () => {
    expect(message).toMatch(/not an award/i);
    expect(message).toMatch(/not a commitment of funds/i);
  });

  it("states plainly that the funder is NOT verified to the same standard", () => {
    // The platform verifies organisations hard and funders not at all. Saying
    // so is what stops a shortlist email lending ImpactBridge's credibility to
    // a name somebody typed into a free-text box.
    expect(message).toMatch(/have NOT verified/);
    expect(message).toMatch(/introduction, not an endorsement/i);
  });

  it("warns against the advance-fee scam this channel would otherwise enable", () => {
    expect(message).toMatch(/never ask you to pay a fee/i);
    expect(message).toMatch(/share bank credentials/i);
  });

  it("carries the reviewer's note when there is one", () => {
    const withNote = buildShortlistMessage({
      opportunityTitle: "X",
      funderName: "Y",
      note: "80G renewal in progress; funder accepts.",
    });
    expect(withNote).toContain("80G renewal in progress");
  });
});
