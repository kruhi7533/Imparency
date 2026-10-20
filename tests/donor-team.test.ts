import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Donor organisations with team roles. A member acts for the organisation's
 * account within their role; another account's rows stay closed; a VIEWER
 * changes nothing; team management is owner/admin only; invites are accepted
 * exactly once; nobody's own CSR work gets hidden by joining another org.
 */

const db = vi.hoisted(() => ({
  donorTeamMember: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  donorTeamInvite: { upsert: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  donorEvent: { create: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  sponsorRequirement: { count: vi.fn() },
  contract: { findUnique: vi.fn(), count: vi.fn() },
  contractPayment: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false, response: null })) }));
vi.mock("@/lib/prisma", () => ({ default: db }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendDonorTeamInviteEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/contract-service", () => ({ signContract: vi.fn(async () => ({ id: "c-1", status: "ACTIVE" })) }));

import { getServerSession } from "next-auth/next";
import { donorActsFor, donorCan, resolveDonorAccount } from "@/lib/donor-team";
import { acceptDonorInviteOnSignup, changeTeamRole, inviteTeamMember, removeTeamMember } from "@/lib/donor-team-admin";
import { workflowRole } from "@/lib/requirements/access";
import { POST as SIGN } from "@/app/api/contracts/[id]/sign/route";
import { POST as PAY } from "@/app/api/contracts/[id]/payments/route";

const member = (accountId: string, role: string) => ({ accountId, role });
const asUser = (id: string) => (getServerSession as any).mockResolvedValue({ user: { id, role: "DONOR" } });

beforeEach(() => {
  vi.clearAllMocks();
  db.donorTeamMember.findUnique.mockResolvedValue(null);
  db.sponsorRequirement.count.mockResolvedValue(0);
  db.contract.count.mockResolvedValue(0);
});

describe("capabilities", () => {
  it("VIEWER only views; APPROVER decides and pays but cannot edit or manage; ADMIN all but nothing else is special", () => {
    expect(donorCan("VIEWER", "view")).toBe(true);
    for (const cap of ["editRequirements", "decide", "pay", "terminate", "manageTeam"] as const) expect(donorCan("VIEWER", cap)).toBe(false);
    expect(donorCan("APPROVER", "decide")).toBe(true);
    expect(donorCan("APPROVER", "pay")).toBe(true);
    expect(donorCan("APPROVER", "editRequirements")).toBe(false);
    expect(donorCan("APPROVER", "manageTeam")).toBe(false);
    expect(donorCan("APPROVER", "terminate")).toBe(false);
    for (const cap of ["editRequirements", "decide", "pay", "terminate", "manageTeam"] as const) expect(donorCan("ADMIN", cap)).toBe(true);
  });

  it("a non-member acts for their own account as OWNER; a member for the organisation's", async () => {
    expect(await resolveDonorAccount("solo")).toEqual({ accountId: "solo", role: "OWNER" });
    db.donorTeamMember.findUnique.mockResolvedValue(member("acme", "APPROVER"));
    expect(await resolveDonorAccount("priya")).toEqual({ accountId: "acme", role: "APPROVER" });
  });

  it("tenant isolation: a member of org A never acts for org B's rows", async () => {
    db.donorTeamMember.findUnique.mockResolvedValue(member("acme", "ADMIN"));
    expect(await donorActsFor("priya", "acme", "decide")).toBe("ADMIN");
    expect(await donorActsFor("priya", "globex", "view")).toBeNull();
  });
});

describe("requirements: workflowRole", () => {
  const req = { sponsorId: "acme" };
  it("an APPROVER member may decide on the org's requirement but not edit it; a VIEWER may only read", () => {
    const approver = { id: "priya", role: "DONOR" as const, name: null, email: null, accountId: "acme", donorRole: "APPROVER" as const };
    expect(workflowRole(req, approver, "decide")).toBe("DONOR");
    expect(() => workflowRole(req, approver, "editRequirements")).toThrow(/role/i);
    const viewer = { ...approver, donorRole: "VIEWER" as const };
    expect(workflowRole(req, viewer)).toBe("DONOR");
    expect(() => workflowRole(req, viewer, "decide")).toThrow(/role/i);
  });

  it("another organisation's requirement is forbidden whatever the role", () => {
    const admin = { id: "priya", role: "DONOR" as const, name: null, email: null, accountId: "globex", donorRole: "ADMIN" as const };
    expect(() => workflowRole(req, admin, "view")).toThrow();
  });
});

describe("contracts: signing and paying as a team member", () => {
  const ctx = { params: { id: "c-1" } };
  const post = (body: unknown = {}) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });

  beforeEach(() => {
    db.contract.findUnique.mockResolvedValue({ id: "c-1", donorId: "acme", ngoId: "ngo-1", status: "UNDER_REVIEW", ngo: { userId: "ngo-user" } });
  });

  it("an APPROVER of the donor organisation can sign", async () => {
    asUser("priya");
    db.donorTeamMember.findUnique.mockResolvedValue(member("acme", "APPROVER"));
    expect((await SIGN(post({ signerName: "Priya Rao", signerTitle: "CSR Head" }), ctx)).status).toBe(200);
  });

  it("a VIEWER is refused with a reason; a member of another organisation is refused", async () => {
    asUser("priya");
    db.donorTeamMember.findUnique.mockResolvedValue(member("acme", "VIEWER"));
    const res = await SIGN(post({ signerName: "Priya Rao", signerTitle: "CSR Head" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/role/i);
    db.donorTeamMember.findUnique.mockResolvedValue(member("globex", "ADMIN"));
    expect((await SIGN(post({ signerName: "P", signerTitle: "T" }), ctx)).status).toBe(403);
  });

  it("a VIEWER cannot record a payment", async () => {
    asUser("priya");
    db.contract.findUnique.mockResolvedValue({ id: "c-1", donorId: "acme", ngoId: "ngo-1" });
    db.donorTeamMember.findUnique.mockResolvedValue(member("acme", "VIEWER"));
    const res = await PAY(post({ idempotencyKey: "key-12345678", amount: "100", mode: "SANDBOX" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/role/i);
  });
});

describe("team management", () => {
  it("only an owner or admin can invite; an admin cannot create another admin", async () => {
    db.donorTeamMember.findUnique.mockResolvedValue(member("acme", "APPROVER"));
    await expect(inviteTeamMember("priya", "x@acme.com", "VIEWER")).rejects.toMatchObject({ status: 403 });
    db.donorTeamMember.findUnique.mockResolvedValue(member("acme", "ADMIN"));
    await expect(inviteTeamMember("priya", "x@acme.com", "ADMIN")).rejects.toMatchObject({ status: 403 });
  });

  it("a new email gets an invite on the owner's account; the event log carries no email", async () => {
    db.user.findUnique.mockImplementation(async ({ where }: any) => (where.id ? { companyName: "Acme", name: "Owner" } : null));
    db.donorTeamInvite.upsert.mockResolvedValue({ id: "inv-1", token: "tok" });
    const r = await inviteTeamMember("acme", "New@Acme.com ", "APPROVER");
    expect(r).toEqual({ added: false, inviteId: "inv-1" });
    expect(db.donorTeamInvite.upsert.mock.calls[0][0].where).toEqual({ email_accountId: { email: "new@acme.com", accountId: "acme" } });
    expect(JSON.stringify(db.donorEvent.create.mock.calls)).not.toContain("@");
  });

  it("an existing donor who already owns CSR work cannot be pulled into another org", async () => {
    db.user.findUnique.mockImplementation(async ({ where }: any) => (where.id ? { companyName: "Acme" } : { id: "rahul", role: "DONOR" }));
    db.sponsorRequirement.count.mockResolvedValue(2);
    await expect(inviteTeamMember("acme", "rahul@x.com", "VIEWER")).rejects.toMatchObject({ status: 409 });
    expect(db.donorTeamMember.create).not.toHaveBeenCalled();
  });

  it("an NGO user or someone in another org cannot be added", async () => {
    db.user.findUnique.mockImplementation(async ({ where }: any) => (where.id ? { companyName: "Acme" } : { id: "ngo-u", role: "NGO" }));
    await expect(inviteTeamMember("acme", "ngo@x.com", "VIEWER")).rejects.toMatchObject({ status: 400 });
    db.user.findUnique.mockImplementation(async ({ where }: any) => (where.id ? { companyName: "Acme" } : { id: "rahul", role: "DONOR" }));
    db.donorTeamMember.findUnique.mockImplementation(async ({ where }: any) => (where.userId === "rahul" ? { accountId: "globex" } : null));
    await expect(inviteTeamMember("acme", "rahul@x.com", "VIEWER")).rejects.toMatchObject({ status: 409 });
  });

  it("changing a role or removing a member of another organisation is 404", async () => {
    db.donorTeamMember.findUnique.mockImplementation(async ({ where }: any) =>
      where.userId ? null : where.id === "m-globex" ? { accountId: "globex", userId: "x", role: "VIEWER" } : null
    );
    await expect(changeTeamRole("acme", "m-globex", "APPROVER")).rejects.toMatchObject({ status: 404 });
    await expect(removeTeamMember("acme", "m-globex")).rejects.toMatchObject({ status: 404 });
    expect(db.donorTeamMember.delete).not.toHaveBeenCalled();
  });

  it("any member may leave on their own", async () => {
    db.donorTeamMember.findUnique.mockImplementation(async ({ where }: any) => (where.id === "m-1" ? { accountId: "acme", userId: "priya", role: "VIEWER" } : null));
    await removeTeamMember("priya", "m-1");
    expect(db.donorTeamMember.delete).toHaveBeenCalledWith({ where: { id: "m-1" } });
  });
});

describe("invite acceptance at signup", () => {
  it("joins the inviting organisation exactly once (compare-and-swap on accepted)", async () => {
    db.donorTeamInvite.findFirst.mockResolvedValue({ id: "inv-1", accountId: "acme", role: "APPROVER" });
    db.donorTeamInvite.updateMany.mockResolvedValue({ count: 1 });
    expect(await acceptDonorInviteOnSignup({ id: "new", email: "New@acme.com", role: "DONOR" })).toEqual({ accountId: "acme", role: "APPROVER" });
    expect(db.donorTeamMember.create).toHaveBeenCalledTimes(1);

    db.donorTeamInvite.updateMany.mockResolvedValue({ count: 0 });
    expect(await acceptDonorInviteOnSignup({ id: "new2", email: "new@acme.com", role: "DONOR" })).toBeNull();
    expect(db.donorTeamMember.create).toHaveBeenCalledTimes(1);
  });

  it("an NGO signup never joins a donor organisation, and a failure never throws", async () => {
    expect(await acceptDonorInviteOnSignup({ id: "n", email: "a@b.c", role: "NGO" })).toBeNull();
    db.donorTeamInvite.findFirst.mockRejectedValue(new Error("db down"));
    expect(await acceptDonorInviteOnSignup({ id: "n", email: "a@b.c", role: "DONOR" })).toBeNull();
  });
});
