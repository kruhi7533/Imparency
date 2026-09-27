import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * WEEK5 SPEC-3 (donor asks for changes) and SPEC-4 (V1 survives V2) on the CSR
 * requirement track: OpportunityResponse + OpportunityResponseRevision.
 */

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
  requirementMatch: { findMany: vi.fn() },
  sponsorRequirement: { findUnique: vi.fn(), updateMany: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  opportunityResponse: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  opportunityResponseRevision: { create: vi.fn(), findMany: vi.fn() },
  reviewThread: { findFirst: vi.fn() },
  notification: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/inquiry-thread", () => ({ openNgoInquiryThread: vi.fn(async () => "thread-1"), appendToThread: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { openNgoInquiryThread } from "@/lib/inquiry-thread";
import { POST as requestChanges } from "@/app/api/requirements/[id]/responses/[responseId]/request-changes/route";
import { GET as listVersions } from "@/app/api/requirements/[id]/responses/[responseId]/versions/route";
import { POST as submitInterest } from "@/app/api/opportunities/[id]/interest/route";
import {
  assertResponseTransition,
  canTransitionResponse,
  RESPONSE_STATUSES,
  type OpportunityResponseStatus,
} from "@/lib/requirements/response-status";
import type { ActorRole } from "@/lib/requirements/status";

const DONOR = { id: "donor-1", role: "DONOR" };
const OTHER_DONOR = { id: "donor-2", role: "DONOR" };
const ADMIN = { id: "admin-1", role: "ADMIN" };
const NGO_A = { id: "ngo-user-a", role: "NGO" };
const NGO_B = { id: "ngo-user-b", role: "NGO" };

const NOTE = "Please reduce the budget to ₹6,00,000 and add quarterly attendance targets.";

const signIn = (user: { id: string; role: string }) => (getServerSession as any).mockResolvedValue({ user });
const json = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
const rcCtx = { params: { id: "req-1", responseId: "resp-1" } };

const requirement = (over: Record<string, unknown> = {}) => ({
  id: "req-1",
  sponsorId: "donor-1",
  status: "NGO_RESPONSE",
  version: 6,
  extractedFields: { sector: { value: "Education", confidence: 1 }, state: { value: "Assam", confidence: 1 } },
  ...over,
});

const response = (over: Record<string, unknown> = {}) => ({
  id: "resp-1",
  requirementId: "req-1",
  ngoId: "ngo-a",
  projectId: "proj-1",
  status: "PROPOSAL_SUBMITTED",
  version: 1,
  revisionRounds: 0,
  proposedBudget: 700000,
  proposedDurationMonths: 12,
  implementationPlan: "Plan v1",
  expectedOutcomes: "Outcomes v1",
  complianceNotes: null,
  milestones: [{ title: "Setup", amount: 300000 }],
  submittedAt: new Date("2026-09-20"),
  changeRequestNote: null,
  ngo: { id: "ngo-a", orgName: "Assam Education Foundation" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.sponsorRequirement.findUnique.mockResolvedValue(requirement());
  db.opportunityResponse.findUnique.mockResolvedValue(response());
  db.opportunityResponse.updateMany.mockResolvedValue({ count: 1 });
  db.opportunityResponse.findUniqueOrThrow.mockImplementation(async () => response({ status: "CHANGES_REQUESTED", revisionRounds: 1 }));
  db.requirementAuditLog.create.mockResolvedValue({});
  db.reviewThread.findFirst.mockResolvedValue(null);
});

describe("response state machine", () => {
  const ROLES: ActorRole[] = ["DONOR", "NGO", "ADMIN", "SYSTEM"];
  const LEGAL: Array<[OpportunityResponseStatus, OpportunityResponseStatus, ActorRole[]]> = [
    ["INTERESTED", "PROPOSAL_SUBMITTED", ["NGO"]],
    ["INTERESTED", "REJECTED", ["DONOR", "ADMIN"]],
    ["PROPOSAL_SUBMITTED", "CHANGES_REQUESTED", ["DONOR", "ADMIN"]],
    ["PROPOSAL_SUBMITTED", "SELECTED", ["DONOR", "ADMIN"]],
    ["PROPOSAL_SUBMITTED", "REJECTED", ["DONOR", "ADMIN"]],
    ["CHANGES_REQUESTED", "PROPOSAL_SUBMITTED", ["NGO"]],
    ["CHANGES_REQUESTED", "REJECTED", ["DONOR", "ADMIN"]],
    ["UNDER_REVIEW", "CHANGES_REQUESTED", ["DONOR", "ADMIN"]],
    ["UNDER_REVIEW", "SELECTED", ["DONOR", "ADMIN"]],
    ["UNDER_REVIEW", "REJECTED", ["DONOR", "ADMIN"]],
    ["SHORTLISTED", "SELECTED", ["DONOR", "ADMIN"]],
    ["SHORTLISTED", "REJECTED", ["DONOR", "ADMIN"]],
  ];

  it("every illegal transition is a 400 and every legal one by the wrong role is a 403", () => {
    for (const from of RESPONSE_STATUSES) {
      for (const to of RESPONSE_STATUSES) {
        const legal = LEGAL.find(([f, t]) => f === from && t === to);
        for (const role of ROLES) {
          if (!legal) {
            expect(() => assertResponseTransition(from, to, role)).toThrow(expect.objectContaining({ status: 400 }));
          } else if (!legal[2].includes(role)) {
            expect(() => assertResponseTransition(from, to, role)).toThrow(expect.objectContaining({ status: 403 }));
          } else {
            expect(canTransitionResponse(from, to, role)).toBe(true);
          }
        }
      }
    }
  });

  it("SELECTED and REJECTED are terminal", () => {
    for (const to of RESPONSE_STATUSES) {
      expect(canTransitionResponse("SELECTED", to, "DONOR")).toBe(false);
      expect(canTransitionResponse("REJECTED", to, "DONOR")).toBe(false);
    }
  });
});

describe("POST …/responses/[responseId]/request-changes", () => {
  it("sends a submitted proposal back with the note, counts the round, and leaves the requirement in NGO_RESPONSE", async () => {
    signIn(DONOR);
    const res = await requestChanges(json({ note: NOTE }), rcCtx);
    expect(res.status).toBe(200);
    expect(db.opportunityResponse.updateMany).toHaveBeenCalledWith({
      where: { id: "resp-1", status: "PROPOSAL_SUBMITTED", version: 1 },
      data: expect.objectContaining({
        status: "CHANGES_REQUESTED",
        changeRequestNote: NOTE,
        changeRequestedById: "donor-1",
        revisionRounds: { increment: 1 },
      }),
    });
    // The requirement itself does not move.
    expect(db.sponsorRequirement.updateMany).not.toHaveBeenCalled();
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "NGO_RESPONSE_CHANGES_REQUESTED",
        fromStatus: "NGO_RESPONSE",
        toStatus: "NGO_RESPONSE",
      }),
    });
    // The NGO is told in its inbox — without naming the donor.
    expect(openNgoInquiryThread).toHaveBeenCalledWith(
      expect.objectContaining({ ngoId: "ngo-a", adminId: null, entityType: "REQUIREMENT", entityId: "req-1" })
    );
    const body = (openNgoInquiryThread as any).mock.calls[0][0].body as string;
    expect(body).toContain(NOTE);
    expect(body).not.toMatch(/donor-1|Acme/);
  });

  it("an admin may request changes too", async () => {
    signIn(ADMIN);
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(200);
  });

  it("an empty or too-short note is refused and nothing is written", async () => {
    signIn(DONOR);
    for (const note of ["", "   ", "too short"]) {
      const res = await requestChanges(json({ note }), rcCtx);
      expect(res.status).toBe(400);
    }
    expect(db.opportunityResponse.updateMany).not.toHaveBeenCalled();
  });

  it("another donor cannot request changes on this requirement (403)", async () => {
    signIn(OTHER_DONOR);
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(403);
    expect(db.opportunityResponse.updateMany).not.toHaveBeenCalled();
  });

  it("an NGO cannot request changes (403)", async () => {
    signIn(NGO_A);
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(403);
  });

  it("is idempotent: a second request on a CHANGES_REQUESTED response is refused and does not count another round", async () => {
    signIn(DONOR);
    db.opportunityResponse.findUnique.mockResolvedValue(response({ status: "CHANGES_REQUESTED", revisionRounds: 1 }));
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(400);
    expect(db.opportunityResponse.updateMany).not.toHaveBeenCalled();
  });

  it("a concurrent change (row moved since it was read) is a 409, not a second round", async () => {
    signIn(DONOR);
    db.opportunityResponse.updateMany.mockResolvedValue({ count: 0 });
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(409);
  });

  it("an approved (SELECTED) proposal cannot be sent back", async () => {
    signIn(DONOR);
    db.opportunityResponse.findUnique.mockResolvedValue(response({ status: "SELECTED" }));
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(400);
  });

  it("an expression of interest (no proposal yet) cannot be sent back", async () => {
    signIn(DONOR);
    db.opportunityResponse.findUnique.mockResolvedValue(response({ status: "INTERESTED" }));
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(400);
  });

  it("only while proposals are being reviewed (requirement NGO_RESPONSE)", async () => {
    signIn(DONOR);
    db.sponsorRequirement.findUnique.mockResolvedValue(requirement({ status: "SELECTED" }));
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(400);
  });

  it("a response from another requirement is a 404", async () => {
    signIn(DONOR);
    db.opportunityResponse.findUnique.mockResolvedValue(response({ requirementId: "req-other" }));
    expect((await requestChanges(json({ note: NOTE }), rcCtx)).status).toBe(404);
  });
});

describe("NGO revision (submitInterest) — versioning", () => {
  const interestCtx = { params: { id: "req-1" } };
  const revision = { projectId: "proj-1", proposedBudget: 600000, implementationPlan: "Plan v2", proposedDurationMonths: 12 };

  beforeEach(() => {
    db.nGOProfile.findUnique.mockImplementation(async (args: any) =>
      args.select?.verificationStatus
        ? { orgName: "Assam Education Foundation", verificationStatus: "VERIFIED", isSuspended: false }
        : args.where?.userId === "ngo-user-a"
        ? { id: "ngo-a" }
        : args.where?.userId === "ngo-user-b"
        ? { id: "ngo-b" }
        : null
    );
    db.requirementMatch.findMany.mockImplementation(async (args: any) =>
      args.where.ngoId === "ngo-a"
        ? [{ requirementId: "req-1", invitedAt: new Date(), project: { id: "proj-1", title: "Classrooms" }, requirement: requirement() }]
        : []
    );
    db.opportunityResponse.findUnique.mockImplementation(async (args: any) =>
      args.where?.requirementId_ngoId?.ngoId === "ngo-a"
        ? response({ status: "CHANGES_REQUESTED", revisionRounds: 1, changeRequestNote: NOTE })
        : null
    );
    db.opportunityResponse.findUniqueOrThrow.mockImplementation(async () =>
      response({ ...revision, status: "PROPOSAL_SUBMITTED", version: 2, revisionRounds: 1 })
    );
  });

  it("round trip: a revision snapshots V1 (with the donor's note) and becomes V2, PROPOSAL_SUBMITTED", async () => {
    signIn(NGO_A);
    const res = await submitInterest(json(revision), interestCtx);
    expect(res.status).toBe(201);

    expect(db.opportunityResponseRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        responseId: "resp-1",
        version: 1,
        implementationPlan: "Plan v1",
        proposedBudget: 700000,
        supersededBecause: NOTE,
        changedByRole: "NGO",
      }),
    });
    expect(db.opportunityResponse.updateMany).toHaveBeenCalledWith({
      where: { id: "resp-1", status: "CHANGES_REQUESTED", version: 1 },
      data: expect.objectContaining({ status: "PROPOSAL_SUBMITTED", version: 2, implementationPlan: "Plan v2" }),
    });
    // The snapshot is written before the overwrite.
    const snapshotOrder = db.opportunityResponseRevision.create.mock.invocationCallOrder[0];
    const updateOrder = db.opportunityResponse.updateMany.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(updateOrder);

    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "NGO_RESPONSE_REVISED" }),
    });
    // The donor is told a revision is waiting.
    expect(db.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "donor-1", type: "CSR_PROPOSAL_REVISED" }),
    });
    const data = await res.json();
    expect(data.response).toMatchObject({ status: "PROPOSAL_SUBMITTED", version: 2 });
  });

  it("a revision cannot downgrade to an expression of interest", async () => {
    signIn(NGO_A);
    const res = await submitInterest(json({ projectId: "proj-1" }), interestCtx);
    expect(res.status).toBe(400);
    expect(db.opportunityResponseRevision.create).not.toHaveBeenCalled();
  });

  it("an interest-only response turning into the first proposal is V1 — no snapshot", async () => {
    signIn(NGO_A);
    db.opportunityResponse.findUnique.mockImplementation(async (args: any) =>
      args.where?.requirementId_ngoId ? response({ status: "INTERESTED", proposedBudget: null, implementationPlan: null }) : null
    );
    db.opportunityResponse.findUniqueOrThrow.mockResolvedValue(response({ ...revision, status: "PROPOSAL_SUBMITTED", version: 1 }));
    const res = await submitInterest(json(revision), interestCtx);
    expect(res.status).toBe(201);
    expect(db.opportunityResponseRevision.create).not.toHaveBeenCalled();
    expect(db.opportunityResponse.updateMany.mock.calls[0][0].data.version).toBeUndefined();
  });

  it("an NGO that was not invited cannot submit against the opportunity (403)", async () => {
    signIn(NGO_B);
    expect((await submitInterest(json(revision), interestCtx)).status).toBe(403);
    expect(db.opportunityResponse.updateMany).not.toHaveBeenCalled();
  });
});

describe("GET …/responses/[responseId]/versions", () => {
  const ctx = { params: { id: "req-1", responseId: "resp-1" } };

  beforeEach(() => {
    db.opportunityResponse.findUnique.mockResolvedValue({ id: "resp-1", requirementId: "req-1", ngoId: "ngo-a" });
    db.opportunityResponseRevision.findMany.mockResolvedValue([
      { version: 1, status: "CHANGES_REQUESTED", proposedBudget: 700000, submittedAt: new Date("2026-09-20"), createdAt: new Date(), supersededBecause: NOTE },
    ]);
    db.nGOProfile.findUnique.mockImplementation(async (args: any) =>
      args.where?.userId === "ngo-user-a" ? { id: "ngo-a" } : args.where?.userId === "ngo-user-b" ? { id: "ngo-b" } : null
    );
  });

  it("the requirement owner, an admin and the owning NGO can read V1", async () => {
    for (const user of [DONOR, ADMIN, NGO_A]) {
      signIn(user);
      const res = await listVersions(new Request("http://localhost"), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.revisions[0]).toMatchObject({ version: 1, proposedBudget: 700000, supersededBecause: NOTE });
    }
  });

  it("another NGO and another donor get 403", async () => {
    for (const user of [NGO_B, OTHER_DONOR]) {
      signIn(user);
      expect((await listVersions(new Request("http://localhost"), ctx)).status).toBe(403);
    }
    expect(db.opportunityResponseRevision.findMany).not.toHaveBeenCalled();
  });
});
