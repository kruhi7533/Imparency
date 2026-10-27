import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NEG-003 — a beneficiary's consent withdrawal propagates:
 *  - generated stories that used the material are unpublished and marked
 *    NEEDS_REGENERATION (on the first call AND on replays, so a retry heals);
 *  - donor story views only ever list PUBLISHED stories;
 *  - signed photo links already handed out stop working (the photo route
 *    re-checks consent on every signed fetch, lib/evidence-access.ts);
 *  - outcome figures citing it render "unverified" (tests/contract-impact-reports).
 */

vi.mock("@/lib/prisma", () => ({
  default: {
    nGOProfile: { findUnique: vi.fn() },
    nGOTeamMember: { findFirst: vi.fn() },
    beneficiaryFeedback: { findUnique: vi.fn(), updateMany: vi.fn() },
    impactStory: { updateMany: vi.fn(), findMany: vi.fn() },
    fieldEvidence: { findUnique: vi.fn() },
    contract: { findFirst: vi.fn() },
    donorTeamMember: { findUnique: vi.fn() },
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/storage", () => ({ readPrivateFile: vi.fn(async () => Buffer.from("img")) }));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { POST as WITHDRAW } from "@/app/api/field/feedback/[id]/withdraw/route";
import { GET as PHOTO } from "@/app/api/field/evidence/[id]/photo/route";
import { GET as DONOR_STORIES } from "@/app/api/donor/impact-stories/route";
import { GET as PUBLIC_STORIES } from "@/app/api/impact-stories/route";

const db = prisma as any;
const session = (id: string, role: string) => (getServerSession as any).mockResolvedValue({ user: { id, role } });

beforeEach(() => {
  vi.clearAllMocks();
  db.nGOProfile.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.userId === "u-owner" ? { id: "ngo-a" } : null));
  db.nGOTeamMember.findFirst.mockResolvedValue(null);
  db.beneficiaryFeedback.findUnique.mockResolvedValue({ id: "fb-1", ngoId: "ngo-a", withdrawnAt: null, evidenceId: "ev-1" });
  db.beneficiaryFeedback.updateMany.mockResolvedValue({ count: 1 });
  db.impactStory.updateMany.mockResolvedValue({ count: 2 });
  db.donorTeamMember.findUnique.mockResolvedValue(null);
});

describe("withdrawal → stories", () => {
  it("unpublishes and flags every story that used the feedback or its photo", async () => {
    session("u-owner", "NGO");
    const res = await WITHDRAW(new Request("http://t", { method: "POST" }), { params: { id: "fb-1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).storiesUnpublished).toBe(2);
    const call = db.impactStory.updateMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ["DRAFT", "IN_REVIEW", "PUBLISHED"] });
    expect(call.where.OR).toEqual([{ sourceFeedbackIds: { has: "fb-1" } }, { sourceEvidenceIds: { has: "ev-1" } }]);
    expect(call.data).toMatchObject({ status: "NEEDS_REGENERATION", publishedAt: null });
  });
  it("a replay propagates again (idempotent, heals a failed earlier propagation)", async () => {
    session("u-owner", "NGO");
    db.beneficiaryFeedback.findUnique.mockResolvedValue({ id: "fb-1", ngoId: "ngo-a", withdrawnAt: new Date(), evidenceId: "ev-1" });
    const res = await WITHDRAW(new Request("http://t", { method: "POST" }), { params: { id: "fb-1" } });
    expect((await res.json()).replayed).toBe(true);
    expect(db.beneficiaryFeedback.updateMany).not.toHaveBeenCalled();
    expect(db.impactStory.updateMany).toHaveBeenCalledTimes(1);
  });
  it("another NGO cannot trigger it", async () => {
    session("u-other", "NGO");
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-b" });
    expect((await WITHDRAW(new Request("http://t", { method: "POST" }), { params: { id: "fb-1" } })).status).toBe(404);
    expect(db.impactStory.updateMany).not.toHaveBeenCalled();
  });
});

describe("withdrawal → donor and public views", () => {
  it("donor story list reads PUBLISHED only, so an unpublished story is gone at once", async () => {
    session("donor-1", "DONOR");
    db.contract.findFirst.mockResolvedValue({ id: "c-1" });
    db.impactStory.findMany.mockResolvedValue([]);
    const res = await DONOR_STORIES(new Request("http://t/api/donor/impact-stories?projectId=p-1"));
    expect(res.status).toBe(200);
    expect(db.impactStory.findMany.mock.calls[0][0].where).toEqual({ projectId: "p-1", status: "PUBLISHED" });
  });
  it("a donor who does not fund the project gets 404", async () => {
    session("donor-2", "DONOR");
    db.contract.findFirst.mockResolvedValue(null);
    expect((await DONOR_STORIES(new Request("http://t/api/donor/impact-stories?projectId=p-1"))).status).toBe(404);
  });
  it("public list reads only PUBLISHED PUBLIC-variant stories", async () => {
    db.impactStory.findMany.mockResolvedValue([]);
    await PUBLIC_STORIES(new Request("http://t/api/impact-stories?projectId=p-1"));
    expect(db.impactStory.findMany.mock.calls[0][0].where).toEqual({ projectId: "p-1", variant: "PUBLIC", status: "PUBLISHED" });
  });
  it("a signed photo link issued BEFORE withdrawal stops working after it", async () => {
    process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret";
    session("donor-1", "DONOR");
    db.contract.findFirst.mockResolvedValue({ id: "c-1" });
    const ev = { ngoId: "ngo-a", projectId: "p-1", photoKey: "k", photoMime: "image/jpeg", status: "APPROVED", containsPeople: true };

    // 1. Consent in place: the route issues a short-lived link signed for this donor.
    db.fieldEvidence.findUnique.mockResolvedValueOnce({ ...ev, feedback: { consentToSharePhoto: true, withdrawnAt: null } });
    const issue = await PHOTO(new Request("http://t/api/field/evidence/ev-1/photo"), { params: { id: "ev-1" } });
    expect(issue.status).toBe(302);
    const signed = issue.headers.get("Location")!;
    expect(signed).toContain("sig=");

    // 2. Still consented: the signed link serves bytes, never cached.
    db.fieldEvidence.findUnique.mockResolvedValueOnce({ ...ev, feedback: { consentToSharePhoto: true, withdrawnAt: null } });
    const ok = await PHOTO(new Request(`http://t${signed}`), { params: { id: "ev-1" } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toContain("no-store");

    // 3. Consent withdrawn: the SAME already-issued link is now refused.
    db.fieldEvidence.findUnique.mockResolvedValueOnce({ ...ev, feedback: { consentToSharePhoto: true, withdrawnAt: new Date() } });
    const after = await PHOTO(new Request(`http://t${signed}`), { params: { id: "ev-1" } });
    expect(after.status).toBe(404);
  });
});
