import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  nGOProfile: { findUnique: vi.fn() },
  nGOTeamMember: { findFirst: vi.fn() },
  requirementMatch: { findMany: vi.fn() },
  opportunityResponse: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  sponsorRequirement: { findUnique: vi.fn(), updateMany: vi.fn() },
  requirementRevision: { create: vi.fn() },
  requirementAuditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

import { getServerSession } from "next-auth/next";
import { GET as listOpportunities } from "@/app/api/opportunities/route";
import { GET as getOpportunity } from "@/app/api/opportunities/[id]/route";
import { POST as expressInterest } from "@/app/api/opportunities/[id]/interest/route";

const NGO_USER = { id: "ngo-user-1", role: "NGO" };
const DONOR = { id: "donor-1", role: "DONOR" };

const FIELDS = {
  summary: { value: "Acme Foundation's confidential FY27 education strategy", confidence: 0.9 },
  sector: { value: "Education", confidence: 0.9 },
  state: { value: "Assam", confidence: 0.9 },
  budgetMin: { value: 5000000, confidence: 0.9 },
  budgetMax: { value: 10000000, confidence: 0.9 },
  durationMonths: { value: 24, confidence: 0.9 },
  contactEmail: { value: "csr@acme.example", confidence: 0.99 },
  contactPerson: { value: "Asha Rao", confidence: 0.99 },
  requiredDocuments: { value: ["FCRA registration"], confidence: 0.9 },
};

const invitedRow = (status = "SHORTLISTED") => ({
  requirementId: "req-1",
  invitedAt: new Date("2026-09-15"),
  project: { id: "proj-1", title: "Digital classrooms" },
  requirement: { id: "req-1", status, extractedFields: FIELDS, selectedNgoId: null },
});

const signIn = (user: { id: string; role: string }) => (getServerSession as any).mockResolvedValue({ user });
const ctx = { params: { id: "req-1" } };
const post = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.nGOProfile.findUnique.mockImplementation(async (args: any) =>
    args.select?.verificationStatus
      ? { orgName: "Assam Education Foundation", verificationStatus: "VERIFIED", isSuspended: false }
      : { id: "ngo-1" }
  );
  db.requirementMatch.findMany.mockResolvedValue([invitedRow()]);
  db.opportunityResponse.findMany.mockResolvedValue([]);
  db.opportunityResponse.findUnique.mockResolvedValue(null);
  db.sponsorRequirement.findUnique.mockResolvedValue({ id: "req-1", status: "SHORTLISTED", version: 3 });
  db.sponsorRequirement.updateMany.mockResolvedValue({ count: 1 });
  db.requirementAuditLog.create.mockResolvedValue({});
});

describe("NGO opportunity briefs", () => {
  it("lists only invited opportunities, as sanitized briefs", async () => {
    signIn(NGO_USER);
    const res = await listOpportunities();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.opportunities).toHaveLength(1);
    expect(body.opportunities[0].brief).toMatchObject({ sector: "Education", state: "Assam", fcraRequired: true });

    const where = db.requirementMatch.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ ngoId: "ngo-1", eligible: true, invitedAt: { not: null } });
  });

  it("never sends the NGO donor identity, contact details, raw text or AI metadata", async () => {
    signIn(NGO_USER);
    const text = JSON.stringify(await (await getOpportunity(new Request("http://localhost"), ctx)).json());
    expect(text).not.toContain("Acme Foundation");
    expect(text).not.toContain("csr@acme.example");
    expect(text).not.toContain("Asha Rao");
    expect(text).not.toMatch(/confidence|rawText|storageKey|fileName|sponsor/);
  });

  it("refuses an opportunity the NGO was not invited to", async () => {
    signIn(NGO_USER);
    db.requirementMatch.findMany.mockResolvedValue([]);
    expect((await getOpportunity(new Request("http://localhost"), ctx)).status).toBe(403);
  });

  it("is not available to donors", async () => {
    signIn(DONOR);
    expect((await listOpportunities()).status).toBe(403);
  });
});

describe("NGO interest", () => {
  it("records a proposal and moves the requirement to NGO_RESPONSE", async () => {
    signIn(NGO_USER);
    db.opportunityResponse.create.mockImplementation(async ({ data }: any) => ({ id: "resp-1", submittedAt: new Date(), ...data }));
    const res = await expressInterest(
      post({ proposedBudget: 8000000, proposedDurationMonths: 24, implementationPlan: "Phase 1: labs", milestones: [{ title: "Labs", amount: 8000000 }] }),
      ctx
    );
    expect(res.status).toBe(201);
    expect(db.opportunityResponse.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ requirementId: "req-1", ngoId: "ngo-1", projectId: "proj-1", status: "PROPOSAL_SUBMITTED" }),
    });
    expect(db.sponsorRequirement.updateMany.mock.calls[0][0].data.status).toBe("NGO_RESPONSE");
    expect(db.requirementAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "NGO_INTEREST_SUBMITTED", actorRole: "NGO" }),
    });
  });

  it("an expression of interest without a plan is recorded as INTERESTED", async () => {
    signIn(NGO_USER);
    db.opportunityResponse.create.mockImplementation(async ({ data }: any) => ({ id: "resp-1", submittedAt: new Date(), ...data }));
    await expressInterest(post({}), ctx);
    expect(db.opportunityResponse.create.mock.calls[0][0].data.status).toBe("INTERESTED");
  });

  it("refuses a project that was not invited", async () => {
    signIn(NGO_USER);
    expect((await expressInterest(post({ projectId: "someone-elses-project" }), ctx)).status).toBe(400);
    expect(db.opportunityResponse.create).not.toHaveBeenCalled();
  });

  it("refuses field staff", async () => {
    signIn(NGO_USER);
    db.nGOProfile.findUnique.mockResolvedValue(null);
    db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-1", role: "FIELD_STAFF" });
    expect((await expressInterest(post({}), ctx)).status).toBe(403);
  });

  it("refuses once the requirement is decided", async () => {
    signIn(NGO_USER);
    db.requirementMatch.findMany.mockResolvedValue([invitedRow("SELECTED")]);
    db.sponsorRequirement.findUnique.mockResolvedValue({ id: "req-1", status: "SELECTED", version: 4 });
    expect((await expressInterest(post({}), ctx)).status).toBe(400);
  });
});
