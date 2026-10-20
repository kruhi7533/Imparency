import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Donor feedback on project updates. Only a donor who funds or follows the
 * project may answer; an answer is an upsert (no vote-stuffing); an update id
 * must belong to the project; and the NGO-facing summary never carries donor
 * identity.
 */

const db = vi.hoisted(() => ({
  contract: { findFirst: vi.fn() },
  donation: { findFirst: vi.fn() },
  impactSubscription: { findFirst: vi.fn() },
  projectImpactEvent: { findUnique: vi.fn() },
  donorUpdateFeedback: { upsert: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { parseFeedback, summariseFeedback } from "@/lib/donor-feedback";
import { PUT } from "@/app/api/donor/update-feedback/route";

const put = (body: unknown) => PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { id: "donor-1", role: "DONOR" } });
  db.contract.findFirst.mockResolvedValue(null);
  db.donation.findFirst.mockResolvedValue({ id: "don-1" });
  db.impactSubscription.findFirst.mockResolvedValue(null);
  db.donorUpdateFeedback.upsert.mockResolvedValue({ signal: "HELPFUL", note: null });
});

describe("parseFeedback", () => {
  it("accepts a project-level or event-level answer and trims the note", () => {
    expect(parseFeedback({ projectId: "p", signal: "HELPFUL" })).toEqual({ ok: true, value: { projectId: "p", eventKey: "", signal: "HELPFUL", note: null } });
    expect(parseFeedback({ projectId: "p", eventId: "e", signal: "NEED_MORE_DETAIL", note: "  How many girls?  " })).toMatchObject({
      ok: true,
      value: { eventKey: "e", note: "How many girls?" },
    });
  });

  it("rejects a missing project, an unknown signal and an over-long note", () => {
    expect(parseFeedback({ signal: "HELPFUL" }).ok).toBe(false);
    expect(parseFeedback({ projectId: "p", signal: "LOVE_IT" }).ok).toBe(false);
    expect(parseFeedback({ projectId: "p", signal: "HELPFUL", note: "x".repeat(501) }).ok).toBe(false);
  });
});

describe("PUT /api/donor/update-feedback", () => {
  it("a donor who donated can answer; it is an upsert keyed on donor + project + update", async () => {
    expect((await put({ projectId: "proj-1", signal: "HELPFUL" })).status).toBe(200);
    expect(db.donorUpdateFeedback.upsert.mock.calls[0][0].where).toEqual({
      donorId_projectId_eventKey: { donorId: "donor-1", projectId: "proj-1", eventKey: "" },
    });
  });

  it("a donor with no tie to the project is refused (403) and nothing is written", async () => {
    db.donation.findFirst.mockResolvedValue(null);
    expect((await put({ projectId: "proj-1", signal: "HELPFUL" })).status).toBe(403);
    expect(db.donorUpdateFeedback.upsert).not.toHaveBeenCalled();
  });

  it("a contract donor or a follower qualifies too", async () => {
    db.donation.findFirst.mockResolvedValue(null);
    db.contract.findFirst.mockResolvedValue({ id: "c-1" });
    expect((await put({ projectId: "proj-1", signal: "HELPFUL" })).status).toBe(200);
    db.contract.findFirst.mockResolvedValue(null);
    db.impactSubscription.findFirst.mockResolvedValue({ id: "s-1" });
    expect((await put({ projectId: "proj-1", signal: "HELPFUL" })).status).toBe(200);
    expect(db.contract.findFirst.mock.calls[0][0].where).toMatchObject({ donorId: "donor-1", projectId: "proj-1", status: { in: ["ACTIVE", "COMPLETED"] } });
  });

  it("an update from another project is 404", async () => {
    db.projectImpactEvent.findUnique.mockResolvedValue({ projectId: "proj-OTHER" });
    expect((await put({ projectId: "proj-1", eventId: "evt-1", signal: "HELPFUL" })).status).toBe(404);
    expect(db.donorUpdateFeedback.upsert).not.toHaveBeenCalled();
  });

  it("only donors", async () => {
    (getServerSession as any).mockResolvedValue({ user: { id: "ngo-user", role: "NGO" } });
    expect((await put({ projectId: "proj-1", signal: "HELPFUL" })).status).toBe(403);
  });
});

describe("summariseFeedback (what the NGO and admin see)", () => {
  it("counts and notes only — donor identity is never selected", async () => {
    db.donorUpdateFeedback.groupBy.mockResolvedValue([
      { signal: "HELPFUL", _count: { _all: 4 } },
      { signal: "NEED_MORE_DETAIL", _count: { _all: 1 } },
    ]);
    db.donorUpdateFeedback.findMany.mockResolvedValue([{ signal: "NEED_MORE_DETAIL", note: "How many girls?", updatedAt: new Date("2026-10-01") }]);
    const s = await summariseFeedback("proj-1");
    expect(s).toMatchObject({ helpful: 4, needMoreDetail: 1 });
    expect(s.notes[0]).toEqual({ signal: "NEED_MORE_DETAIL", note: "How many girls?", at: "2026-10-01T00:00:00.000Z" });
    expect(db.donorUpdateFeedback.findMany.mock.calls[0][0].select).not.toHaveProperty("donorId");
  });
});
