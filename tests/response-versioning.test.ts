import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * WEEK5 SPEC-4 — proposal versioning: a resubmission keeps the previous
 * version instead of overwriting it. The response and revision tables are an
 * in-memory stand-in so several submissions can run back to back.
 */

interface Row { [k: string]: any }
const store = vi.hoisted(() => ({ response: null as Row | null, revisions: [] as Row[] }));

const db = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
  requirementMatch: { findMany: vi.fn() },
  sponsorRequirement: { findUnique: vi.fn(), updateMany: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  notification: { create: vi.fn() },
  opportunityResponse: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  opportunityResponseRevision: { create: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/inquiry-thread", () => ({ openNgoInquiryThread: vi.fn(), appendToThread: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { POST as submit } from "@/app/api/opportunities/[id]/interest/route";

const NGO_A = { id: "ngo-user-a", role: "NGO" };
const ctx = { params: { id: "req-1" } };
const post = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
const proposal = (n: number) => ({
  projectId: "proj-1",
  proposedBudget: 100000 * n,
  implementationPlan: `Plan v${n}`,
  proposedDurationMonths: 12,
  milestones: [{ title: `Milestone v${n}`, amount: 50000 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  store.response = null;
  store.revisions = [];
  (getServerSession as any).mockResolvedValue({ user: NGO_A });
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.nGOProfile.findUnique.mockImplementation(async (args: any) =>
    args.select?.verificationStatus
      ? { orgName: "Assam Education Foundation", verificationStatus: "VERIFIED", isSuspended: false }
      : { id: "ngo-a" }
  );
  db.requirementMatch.findMany.mockResolvedValue([
    {
      requirementId: "req-1",
      invitedAt: new Date(),
      project: { id: "proj-1", title: "Classrooms" },
      requirement: { id: "req-1", status: "NGO_RESPONSE", extractedFields: {}, selectedNgoId: null },
    },
  ]);
  db.sponsorRequirement.findUnique.mockResolvedValue({ id: "req-1", sponsorId: "donor-1", status: "NGO_RESPONSE", version: 5 });
  db.requirementAuditLog.create.mockResolvedValue({});

  db.opportunityResponse.findUnique.mockImplementation(async () => (store.response ? { ...store.response } : null));
  db.opportunityResponse.findUniqueOrThrow.mockImplementation(async () => ({ ...store.response! }));
  db.opportunityResponse.create.mockImplementation(async ({ data }: any) => {
    store.response = { id: "resp-1", version: 1, revisionRounds: 0, changeRequestNote: null, submittedAt: new Date(), ...data };
    return { ...store.response };
  });
  db.opportunityResponse.updateMany.mockImplementation(async ({ where, data }: any) => {
    const r = store.response;
    if (!r || r.id !== where.id || r.status !== where.status || r.version !== where.version) return { count: 0 };
    Object.assign(r, data);
    return { count: 1 };
  });
  db.opportunityResponseRevision.create.mockImplementation(async ({ data }: any) => {
    if (store.revisions.some((v) => v.responseId === data.responseId && v.version === data.version)) {
      throw new Error("unique constraint (responseId, version)");
    }
    store.revisions.push({ ...data });
    return data;
  });
});

describe("proposal versioning", () => {
  it("a resubmission writes a revision holding the OLD values and bumps the live version to 2", async () => {
    expect((await submit(post(proposal(1)), ctx)).status).toBe(201);
    expect((await submit(post(proposal(2)), ctx)).status).toBe(201);

    expect(store.revisions).toHaveLength(1);
    expect(store.revisions[0]).toMatchObject({ version: 1, implementationPlan: "Plan v1", proposedBudget: 100000, changedByRole: "NGO" });
    expect(store.response).toMatchObject({ version: 2, implementationPlan: "Plan v2", proposedBudget: 200000 });
  });

  it("three submissions → two revisions (versions 1 and 2) and a live row at version 3", async () => {
    for (const n of [1, 2, 3]) expect((await submit(post(proposal(n)), ctx)).status).toBe(201);

    expect(store.revisions.map((v) => v.version)).toEqual([1, 2]);
    expect(store.revisions.map((v) => v.implementationPlan)).toEqual(["Plan v1", "Plan v2"]);
    expect(store.response).toMatchObject({ version: 3, implementationPlan: "Plan v3" });
  });

  it("a revision made in reply to a change request carries the donor's note as supersededBecause", async () => {
    await submit(post(proposal(1)), ctx);
    // The donor sends it back (what requestResponseChanges writes).
    Object.assign(store.response!, { status: "CHANGES_REQUESTED", changeRequestNote: "Cut the budget by 20%.", revisionRounds: 1 });
    await submit(post(proposal(2)), ctx);

    expect(store.revisions[0]).toMatchObject({ version: 1, supersededBecause: "Cut the budget by 20%." });
    expect(store.response).toMatchObject({ status: "PROPOSAL_SUBMITTED", version: 2, revisionRounds: 1 });
  });

  it("a revision the NGO makes on its own initiative has no supersededBecause", async () => {
    await submit(post(proposal(1)), ctx);
    await submit(post(proposal(2)), ctx);
    expect(store.revisions[0].supersededBecause).toBeNull();
  });

  it("if the snapshot fails, the live proposal is not overwritten", async () => {
    await submit(post(proposal(1)), ctx);
    db.opportunityResponseRevision.create.mockRejectedValueOnce(new Error("disk full"));
    const res = await submit(post(proposal(2)), ctx);
    expect(res.status).toBe(500);
    expect(store.response).toMatchObject({ version: 1, implementationPlan: "Plan v1" });
  });
});

describe("schema", () => {
  it("deleting a response cascades its revisions (no orphans)", () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "OpportunityResponseRevision")!;
    const relation = model.fields.find((f) => f.name === "response")!;
    expect(relation.relationOnDelete).toBe("Cascade");
  });

  it("one revision per version per response", () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "OpportunityResponseRevision")!;
    expect(model.uniqueFields).toContainEqual(["responseId", "version"]);
  });
});
