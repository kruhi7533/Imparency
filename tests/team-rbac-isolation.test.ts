import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Workstream E behaviour:
 *   DON-002  donor FINANCE vs VIEWER vs APPROVER, at the capability table and at routes
 *   NGO-009/011  field worker sees only own tasks; PM assigns; finance restricted
 *   NEG-001/002/DON-017  cross-tenant: proposals, threads, stale JWT ngoProfileId
 *   NEG-014  donor-facing responses carry no internal notes / reviewer ids / risk
 */

vi.mock("@/lib/prisma", () => {
  const m = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() });
  return {
    default: {
      user: m(),
      nGOProfile: m(),
      nGOTeamMember: m(),
      donorTeamMember: m(),
      proposal: m(),
      contract: m(),
      fieldTask: m(),
      project: m(),
      reviewThread: m(),
      fundingOpportunity: m(),
      matchCandidate: m(),
    },
  };
});
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("next-auth", async (orig) => ({ ...(await (orig as any)()), getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false })) }));
vi.mock("@/lib/bank-statement", () => ({
  loadReconciliationView: vi.fn(async () => ({ imports: [], lines: [], pending: [] })),
  importBankStatement: vi.fn(),
  BankStatementError: class extends Error {},
  MAX_STATEMENT_BYTES: 1_000_000,
}));

import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { getServerSession as getServerSessionRoot } from "next-auth";
import { donorCan, checkDonorAction, type DonorRole } from "@/lib/donor-team";
import { ngoCan, requireNgoMembership, redactForDonor, findForbiddenKeys, getNgoMembership } from "@/lib/tenant-scope";
import { GET as tasksGET, POST as tasksPOST } from "@/app/api/ngo/field-tasks/route";
import { GET as bankGET } from "@/app/api/ngo/bank-statements/route";
import { GET as proposalGET, PUT as proposalPUT } from "@/app/api/proposals/[id]/route";
import { POST as proposalCreate } from "@/app/api/proposals/route";
import { POST as recordPayment } from "@/app/api/contracts/[id]/payments/route";
import { GET as threadsGET } from "@/app/api/ngo/threads/route";

const db = prisma as any;
const s1 = getServerSession as any;
const s2 = getServerSessionRoot as any;
const as = (user: any) => {
  s1.mockResolvedValue({ user });
  s2.mockResolvedValue({ user });
};
/** NGO membership fixture: the caller owns `owned` (or nothing) and is a member of `member`. */
function ngoMembership(owned: string | null, member: { ngoId: string; role: string } | null) {
  db.nGOProfile.findUnique.mockImplementation(async ({ where }: any) => (where.userId && owned ? { id: owned } : null));
  db.nGOProfile.findFirst.mockImplementation(async ({ where }: any) => (owned && where.id === owned ? { id: owned } : null));
  db.nGOTeamMember.findFirst.mockResolvedValue(member);
  db.nGOTeamMember.findUnique.mockImplementation(async ({ where }: any) =>
    member && where.userId_ngoId?.ngoId === member.ngoId ? { role: member.role } : null
  );
}

beforeEach(() => vi.clearAllMocks());

// ─── DON-002 ─────────────────────────────────────────────────────────────────

describe("DON-002 — donor FINANCE role has distinct permissions", () => {
  const caps = ["view", "editRequirements", "decide", "pay", "terminate", "manageTeam"] as const;
  const matrix = (r: DonorRole) => Object.fromEntries(caps.map((c) => [c, donorCan(r, c)]));

  it("finance vs viewer vs approver", () => {
    expect(matrix("FINANCE")).toEqual({ view: true, editRequirements: false, decide: false, pay: true, terminate: false, manageTeam: false });
    expect(matrix("VIEWER")).toEqual({ view: true, editRequirements: false, decide: false, pay: false, terminate: false, manageTeam: false });
    expect(matrix("APPROVER")).toEqual({ view: true, editRequirements: false, decide: true, pay: true, terminate: false, manageTeam: false });
  });

  it("checkDonorAction: a finance member may pay for its own account but not approve, and not act for another account", async () => {
    db.donorTeamMember.findUnique.mockResolvedValue({ accountId: "acct-1", role: "FINANCE" });
    expect(await checkDonorAction("fin-1", "acct-1", "pay")).toEqual({ ok: true, role: "FINANCE" });
    expect(await checkDonorAction("fin-1", "acct-1", "decide")).toEqual({ ok: false, reason: "role" });
    expect(await checkDonorAction("fin-1", "acct-2", "pay")).toEqual({ ok: false, reason: "not_party" });
  });

  it("route: VIEWER cannot record a contract payment (403); FINANCE passes the role gate", async () => {
    db.contract.findUnique.mockResolvedValue({ id: "c1", donorId: "acct-1", ngoId: "ngo-A" });
    as({ id: "v-1", role: "DONOR" });
    db.donorTeamMember.findUnique.mockResolvedValue({ accountId: "acct-1", role: "VIEWER" });
    const denied = await recordPayment(new Request("http://x", { method: "POST", body: "{}" }), { params: { id: "c1" } });
    expect(denied.status).toBe(403);

    as({ id: "fin-1", role: "DONOR" });
    db.donorTeamMember.findUnique.mockResolvedValue({ accountId: "acct-1", role: "FINANCE" });
    const passed = await recordPayment(new Request("http://x", { method: "POST", body: "{}" }), { params: { id: "c1" } });
    expect(passed.status).not.toBe(403); // reaches input validation (empty body → 400)
  });

  it("route: FINANCE cannot request changes on (decide) a proposal", async () => {
    as({ id: "fin-1", role: "DONOR" });
    db.donorTeamMember.findUnique.mockResolvedValue({ accountId: "acct-1", role: "FINANCE" });
    db.proposal.findUnique.mockResolvedValue({ id: "p1", status: "SUBMITTED", ngoId: "ngo-A", opportunity: { funderUserId: "acct-1" }, ngo: { id: "ngo-A", userId: "o" } });
    const res = await proposalPUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ action: "REQUEST_CHANGE", feedback: "x" }) }), { params: { id: "p1" } });
    expect(res.status).toBe(403);
    expect(db.proposal.update).not.toHaveBeenCalled();
  });
});

// ─── NGO-009 / NGO-011 ───────────────────────────────────────────────────────

describe("NGO-011 — a field worker sees only tasks assigned to them", () => {
  it("non-manager query is filtered to assignedToId = self, within their NGO", async () => {
    as({ id: "fw-1", role: "NGO" });
    ngoMembership(null, { ngoId: "ngo-A", role: "FIELD_STAFF" });
    db.fieldTask.findMany.mockResolvedValue([]);
    const res = await tasksGET();
    expect(res.status).toBe(200);
    expect(db.fieldTask.findMany.mock.calls[0][0].where).toMatchObject({ ngoId: "ngo-A", assignedToId: "fw-1" });
  });

  it("a program manager sees all the NGO's tasks", async () => {
    as({ id: "pm-1", role: "NGO" });
    ngoMembership(null, { ngoId: "ngo-A", role: "PROGRAM_MANAGER" });
    db.fieldTask.findMany.mockResolvedValue([]);
    await tasksGET();
    expect(db.fieldTask.findMany.mock.calls[0][0].where).not.toHaveProperty("assignedToId");
  });

  it("NGO-009: a program manager can assign a task to a field worker; a field worker cannot assign", async () => {
    const body = JSON.stringify({ projectId: "proj-1", title: "Photograph the borewell", assignedToId: "fw-1" });
    db.project.findUnique.mockResolvedValue({ ngoId: "ngo-A", isDeleted: false, milestones: [] });
    db.fieldTask.create.mockImplementation(async ({ data }: any) => ({ id: "t1", ...data }));

    as({ id: "pm-1", role: "NGO" });
    ngoMembership(null, { ngoId: "ngo-A", role: "PROGRAM_MANAGER" });
    db.nGOTeamMember.findFirst.mockImplementation(async ({ where }: any) =>
      where.userId === "pm-1" ? { ngoId: "ngo-A", role: "PROGRAM_MANAGER" } : where.userId === "fw-1" ? { id: "m-fw" } : null
    );
    const ok = await tasksPOST(new Request("http://x", { method: "POST", body }));
    expect(ok.status).toBe(201);
    expect(db.fieldTask.create.mock.calls[0][0].data).toMatchObject({ ngoId: "ngo-A", assignedToId: "fw-1" });

    as({ id: "fw-1", role: "NGO" });
    ngoMembership(null, { ngoId: "ngo-A", role: "FIELD_STAFF" });
    const denied = await tasksPOST(new Request("http://x", { method: "POST", body }));
    expect(denied.status).toBe(403);
  });

  it("finance data is OWNER/ADMIN/FINANCE only: a field worker gets 403 on bank statements", async () => {
    as({ id: "fw-1", role: "NGO" });
    ngoMembership(null, { ngoId: "ngo-A", role: "FIELD_STAFF" });
    expect((await bankGET()).status).toBe(403);
    as({ id: "fin-1", role: "NGO" });
    ngoMembership(null, { ngoId: "ngo-A", role: "FINANCE" });
    expect((await bankGET()).status).toBe(200);
    expect(ngoCan("PROGRAM_MANAGER", "finance")).toBe(false);
    expect(ngoCan("FIELD_STAFF", "assignTasks")).toBe(false);
  });
});

// ─── requireNgoMembership ────────────────────────────────────────────────────

describe("requireNgoMembership — the central helper", () => {
  it("accepts team members, not only the owner", async () => {
    ngoMembership(null, { ngoId: "ngo-A", role: "FINANCE" });
    const r = await requireNgoMembership({ user: { id: "fin-1" } }, "ngo-A", "finance");
    expect(r.ok && r.actor).toEqual({ ngoId: "ngo-A", teamRole: "FINANCE", userId: "fin-1" });
  });
  it("org A member gets 404 on org B (indistinguishable from missing)", async () => {
    ngoMembership("ngo-A", null);
    const r = await requireNgoMembership({ user: { id: "owner-A" } }, "ngo-B");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.response.status).toBe(404);
  });
  it("member whose role lacks the capability gets 403", async () => {
    ngoMembership(null, { ngoId: "ngo-A", role: "FIELD_STAFF" });
    const r = await requireNgoMembership({ user: { id: "fw" } }, "ngo-A", "finance");
    expect(!r.ok && r.response.status).toBe(403);
  });
  it("no session → 401", async () => {
    const r = await requireNgoMembership(null, "ngo-A");
    expect(!r.ok && r.response.status).toBe(401);
  });
  it("owner of A is OWNER of A", async () => {
    ngoMembership("ngo-A", null);
    expect(await getNgoMembership("owner-A", "ngo-A")).toEqual({ ngoId: "ngo-A", teamRole: "OWNER", userId: "owner-A" });
  });
});

// ─── NEG-001 / NEG-002 / DON-017 — cross-tenant ─────────────────────────────

describe("cross-tenant isolation on proposals", () => {
  const proposal = {
    id: "p1",
    ngoId: "ngo-B",
    status: "SUBMITTED",
    plan: "plan",
    requestedAmount: 100,
    decisionNote: "internal",
    reviewerId: "admin-7",
    decidedById: "admin-7",
    opportunity: { id: "o1", funderUserId: "acct-B" },
    ngo: { id: "ngo-B", userId: "owner-B" },
  };

  it("an NGO with a stale JWT ngoProfileId pointing at B (removed member) is refused", async () => {
    as({ id: "ex-member", role: "NGO", ngoProfileId: "ngo-B" });
    ngoMembership(null, null);
    db.proposal.findUnique.mockResolvedValue(proposal);
    expect((await proposalGET(new Request("http://x"), { params: { id: "p1" } })).status).toBe(403);
  });

  it("a donor that is not the funder is refused — including when the opportunity has no funder", async () => {
    as({ id: "acct-A", role: "DONOR" });
    db.donorTeamMember.findUnique.mockResolvedValue(null);
    db.proposal.findUnique.mockResolvedValue(proposal);
    expect((await proposalGET(new Request("http://x"), { params: { id: "p1" } })).status).toBe(403);
    db.proposal.findUnique.mockResolvedValue({ ...proposal, opportunity: { id: "o1", funderUserId: null } });
    expect((await proposalGET(new Request("http://x"), { params: { id: "p1" } })).status).toBe(403);
    const put = await proposalPUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ action: "REQUEST_CHANGE", feedback: "x" }) }), { params: { id: "p1" } });
    expect(put.status).toBe(403);
    expect(db.proposal.update).not.toHaveBeenCalled();
  });

  it("NEG-014: the funder (incl. a team member) sees the proposal WITHOUT reviewer ids", async () => {
    as({ id: "viewer-B", role: "DONOR" });
    db.donorTeamMember.findUnique.mockResolvedValue({ accountId: "acct-B", role: "VIEWER" });
    db.proposal.findUnique.mockResolvedValue(proposal);
    const res = await proposalGET(new Request("http://x"), { params: { id: "p1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reviewerId).toBeUndefined();
    expect(json.decidedById).toBeUndefined();
    expect(findForbiddenKeys(json)).toEqual([]);
  });

  it("a FIELD_STAFF member cannot resubmit the proposal budget", async () => {
    as({ id: "fw-B", role: "NGO", ngoProfileId: "ngo-B" });
    ngoMembership(null, { ngoId: "ngo-B", role: "FIELD_STAFF" });
    db.proposal.findUnique.mockResolvedValue({ ...proposal, status: "CHANGE_REQUESTED" });
    const res = await proposalPUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ action: "SUBMIT_V2", budget: "999999" }) }), { params: { id: "p1" } });
    expect(res.status).toBe(403);
    expect(db.proposal.update).not.toHaveBeenCalled();
  });

  it("an NGO cannot drop a proposal into an opportunity it was not shortlisted for", async () => {
    as({ id: "owner-A", role: "NGO" });
    ngoMembership("ngo-A", null);
    db.fundingOpportunity.findUnique.mockResolvedValue({ status: "OPEN" });
    db.matchCandidate.findFirst.mockResolvedValue(null);
    const res = await proposalCreate(new Request("http://x", { method: "POST", body: JSON.stringify({ requirementId: "opp-B", budget: "10" }) }));
    expect(res.status).toBe(403);
    expect(db.proposal.create).not.toHaveBeenCalled();
  });
});

describe("cross-tenant isolation on admin review threads", () => {
  it("lists only the caller's live NGO's threads, never the stale JWT value", async () => {
    as({ id: "ex-member", role: "NGO", ngoProfileId: "ngo-B" });
    ngoMembership(null, null);
    const res = await threadsGET();
    expect(res.status).toBe(404);
    expect(db.reviewThread.findMany).not.toHaveBeenCalled();
  });
});

// ─── NEG-014 redaction helper ────────────────────────────────────────────────

describe("redactForDonor", () => {
  it("removes risk, fraud, internal notes, reviewer ids, bank details and phones at any depth", () => {
    const leaky = {
      id: "n1",
      orgName: "NGO",
      riskScore: 80,
      riskLevel: "HIGH",
      internalNotes: "x",
      bankAccountNumber: "123",
      projects: [{ id: "p", adminNote: "y", beneficiaries: [{ beneficiaryName: "Asha", phone: "9" }] }],
      createdAt: new Date("2026-01-01"),
    };
    const clean = redactForDonor(leaky);
    expect(findForbiddenKeys(clean)).toEqual([]);
    expect(clean.orgName).toBe("NGO");
    expect(clean.createdAt).toBeInstanceOf(Date);
    expect(findForbiddenKeys(leaky).sort()).toEqual(["adminNote", "bankAccountNumber", "beneficiaryName", "internalNotes", "phone", "riskLevel", "riskScore"]);
  });
});
