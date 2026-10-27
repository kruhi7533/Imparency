import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * NGO-003 — NGO team invitations: hashed single-use expiring tokens, revoke,
 * resend (rotates the secret), duplicate-pending, accept for new and existing
 * users, role ceiling, honest "not sent", and no token in list responses.
 */

vi.mock("@/lib/prisma", () => {
  const db: any = {
    user: { findUnique: vi.fn(), create: vi.fn() },
    nGOProfile: { findUnique: vi.fn(), findFirst: vi.fn() },
    nGOTeamMember: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    teamInvite: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { default: db };
});
vi.mock("@/lib/email", () => ({ sendNgoTeamInviteEmail: vi.fn() }));
vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ checkRateLimit: vi.fn(async () => ({ isBlocked: false })) }));

import prisma from "@/lib/prisma";
import { sendNgoTeamInviteEmail } from "@/lib/email";
import { getServerSession } from "next-auth/next";
import {
  acceptInvite,
  createInvite,
  hashInviteToken,
  inviteState,
  listTeam,
  lookupInvite,
  newInviteToken,
  resendInvite,
  revokeInvite,
  changeMemberRole,
} from "@/lib/ngo-team-invites";
import { canGrantRole } from "@/lib/tenant-scope";
import { POST as invitePOST } from "@/app/api/ngo/team/invites/route";
import { GET as teamGET } from "@/app/api/ngo/team/route";
import { POST as revokePOST } from "@/app/api/ngo/team/invites/[id]/revoke/route";

const db = prisma as any;
const mail = sendNgoTeamInviteEmail as any;
const session = getServerSession as any;

const OWNER = { ngoId: "ngo-A", teamRole: "OWNER" as const, userId: "owner-A" };
const ADMIN = { ngoId: "ngo-A", teamRole: "ADMIN" as const, userId: "admin-A" };
const PM = { ngoId: "ngo-A", teamRole: "PROGRAM_MANAGER" as const, userId: "pm-A" };
const future = () => new Date(Date.now() + 86_400_000);
const past = () => new Date(Date.now() - 1000);

function pendingRow(over: any = {}) {
  return {
    id: "inv-1",
    email: "field@example.org",
    role: "FIELD_STAFF",
    ngoId: "ngo-A",
    status: "PENDING",
    accepted: false,
    tokenHash: hashInviteToken("t".repeat(43)),
    expiresAt: future(),
    lastSentAt: new Date(Date.now() - 3_600_000),
    sendCount: 1,
    createdAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  mail.mockResolvedValue({ success: true, mock: true }); // no provider configured locally
  db.nGOProfile.findUnique.mockResolvedValue({ orgName: "Akshar" });
});

describe("tokens", () => {
  it("are 32 random bytes, stored only as sha256", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.tokenHash).toBe(hashInviteToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });

  it("state: pending / expired / revoked / accepted", () => {
    expect(inviteState(pendingRow())).toBe("PENDING");
    expect(inviteState(pendingRow({ expiresAt: past() }))).toBe("EXPIRED");
    expect(inviteState(pendingRow({ status: "REVOKED" }))).toBe("REVOKED");
    expect(inviteState(pendingRow({ status: "ACCEPTED" }))).toBe("ACCEPTED");
  });
});

describe("role ceiling — nobody grants above their own", () => {
  it("owner can grant admin; admin can grant admin/PM/finance/field; PM and field cannot invite at all", () => {
    expect(canGrantRole("OWNER", "ADMIN")).toBe(true);
    expect(canGrantRole("ADMIN", "ADMIN")).toBe(true);
    expect(canGrantRole("ADMIN", "PROGRAM_MANAGER")).toBe(true);
    expect(canGrantRole("ADMIN", "OWNER")).toBe(false);
    expect(canGrantRole("PROGRAM_MANAGER", "FIELD_STAFF")).toBe(false);
    expect(canGrantRole("FIELD_STAFF", "FIELD_STAFF")).toBe(false);
    expect(canGrantRole("FINANCE", "FIELD_STAFF")).toBe(false);
  });

  it("createInvite refuses OWNER as a role and refuses non-managers", async () => {
    await expect(createInvite(ADMIN, "x@example.org", "OWNER")).rejects.toMatchObject({ status: 400 });
    await expect(createInvite(PM, "x@example.org", "FIELD_STAFF")).rejects.toMatchObject({ status: 403 });
    expect(db.teamInvite.create).not.toHaveBeenCalled();
  });
});

describe("createInvite", () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue(null);
    db.teamInvite.findUnique.mockResolvedValue(null);
    db.teamInvite.create.mockImplementation(async ({ data }: any) => ({ id: "inv-new", ...data, createdAt: new Date() }));
  });

  it("stores only the hash, and with no email provider says NOT sent and returns the link once", async () => {
    const res: any = await createInvite(OWNER, "  Field@Example.org ", "FIELD_STAFF");
    const data = db.teamInvite.create.mock.calls[0][0].data;
    expect(data.email).toBe("field@example.org");
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data).not.toHaveProperty("token");
    expect(res.emailSent).toBe(false);
    expect(res.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = res.inviteUrl.split("/invite/")[1];
    expect(hashInviteToken(token)).toBe(data.tokenHash);
    // The safe invite object carries no secret.
    expect(JSON.stringify(res.invite)).not.toContain(token);
    expect(res.invite).not.toHaveProperty("tokenHash");
    // 7-day expiry
    const days = (data.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("when the email really went out, the link is NOT returned", async () => {
    mail.mockResolvedValue({ success: true });
    const res: any = await createInvite(OWNER, "f@example.org", "PROGRAM_MANAGER");
    expect(res.emailSent).toBe(true);
    expect(res.inviteUrl).toBeUndefined();
  });

  it("a delivery failure is reported as not sent", async () => {
    mail.mockResolvedValue({ success: false, error: "smtp down" });
    const res: any = await createInvite(OWNER, "f@example.org", "FIELD_STAFF");
    expect(res.emailSent).toBe(false);
  });

  it("duplicate pending invite → 409 INVITE_PENDING (resend or revoke instead)", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow());
    await expect(createInvite(OWNER, "field@example.org", "FIELD_STAFF")).rejects.toMatchObject({ status: 409, code: "INVITE_PENDING" });
  });

  it("an expired or revoked invite to the same email is reset with a fresh secret", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ status: "REVOKED" }));
    db.teamInvite.update.mockImplementation(async ({ data }: any) => ({ ...pendingRow(), ...data }));
    const res: any = await createInvite(OWNER, "field@example.org", "FIELD_STAFF");
    const data = db.teamInvite.update.mock.calls[0][0].data;
    expect(data.status).toBe("PENDING");
    expect(data.tokenHash).not.toBe(pendingRow().tokenHash);
    expect(res.invite.state).toBe("PENDING");
  });

  it("an existing member of this NGO cannot be invited again", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u-9", role: "NGO", ngoProfile: null });
    db.nGOTeamMember.findUnique.mockResolvedValue({ id: "m-9" });
    await expect(createInvite(OWNER, "member@example.org", "FIELD_STAFF")).rejects.toMatchObject({ status: 409, code: "ALREADY_MEMBER" });
  });
});

describe("resend and revoke", () => {
  it("resend rotates the secret (old link dies) and extends expiry", async () => {
    const row = pendingRow({ expiresAt: past() }); // expired invites can be resent
    db.teamInvite.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, expiresAt: future(), sendCount: 2 });
    db.teamInvite.updateMany.mockResolvedValue({ count: 1 });
    const res: any = await resendInvite(OWNER, "inv-1");
    const call = db.teamInvite.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "inv-1", status: "PENDING", tokenHash: row.tokenHash });
    expect(call.data.tokenHash).not.toBe(row.tokenHash);
    expect(res.inviteUrl).toBeDefined();
  });

  it("resend within a minute is throttled", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ lastSentAt: new Date() }));
    await expect(resendInvite(OWNER, "inv-1")).rejects.toMatchObject({ status: 429 });
  });

  it("revoke is a compare-and-swap on PENDING; revoking twice is 409", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow());
    db.teamInvite.updateMany.mockResolvedValue({ count: 1 });
    await revokeInvite(OWNER, "inv-1");
    expect(db.teamInvite.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "inv-1", status: "PENDING" }, data: { status: "REVOKED", revokedById: "owner-A" } });
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ status: "REVOKED" }));
    await expect(revokeInvite(OWNER, "inv-1")).rejects.toMatchObject({ status: 409 });
  });

  it("tenant isolation: NGO A cannot resend or revoke NGO B's invite (404)", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ ngoId: "ngo-B" }));
    await expect(revokeInvite(OWNER, "inv-1")).rejects.toMatchObject({ status: 404 });
    await expect(resendInvite(OWNER, "inv-1")).rejects.toMatchObject({ status: 404 });
    expect(db.teamInvite.updateMany).not.toHaveBeenCalled();
  });
});

describe("accept", () => {
  const TOKEN = "t".repeat(43);

  it("invalid / expired / revoked / already-used tokens are refused", async () => {
    db.teamInvite.findUnique.mockResolvedValue(null);
    await expect(acceptInvite(TOKEN, {})).rejects.toMatchObject({ status: 404, code: "INVALID" });
    await expect(acceptInvite("short", {})).rejects.toMatchObject({ status: 404 });
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ expiresAt: past() }));
    await expect(acceptInvite(TOKEN, {})).rejects.toMatchObject({ status: 410, code: "EXPIRED" });
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ status: "REVOKED" }));
    await expect(acceptInvite(TOKEN, {})).rejects.toMatchObject({ status: 410, code: "REVOKED" });
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ status: "ACCEPTED" }));
    await expect(acceptInvite(TOKEN, {})).rejects.toMatchObject({ status: 410, code: "ACCEPTED" });
    expect(db.nGOTeamMember.create).not.toHaveBeenCalled();
  });

  it("looks the token up by its hash, never the plaintext", async () => {
    db.teamInvite.findUnique.mockResolvedValue(null);
    await lookupInvite(TOKEN);
    expect(db.teamInvite.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashInviteToken(TOKEN) } });
  });

  it("new user: creates an NGO-role account + membership in one transaction, single use", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow());
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "new-user" });
    db.teamInvite.updateMany.mockResolvedValue({ count: 1 });
    const res = await acceptInvite(TOKEN, { name: "Field Person", password: "longenough1" });
    expect(res).toMatchObject({ userId: "new-user", role: "FIELD_STAFF", newAccount: true });
    expect(db.user.create.mock.calls[0][0].data).toMatchObject({ email: "field@example.org", role: "NGO" });
    expect(db.user.create.mock.calls[0][0].data.passwordHash).not.toBe("longenough1");
    expect(db.nGOTeamMember.create).toHaveBeenCalledWith({ data: { userId: "new-user", ngoId: "ngo-A", role: "FIELD_STAFF" } });
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("a race: the second accept loses the compare-and-swap and nothing is created", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow());
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: "new-user" });
    db.teamInvite.updateMany.mockResolvedValue({ count: 0 });
    await expect(acceptInvite(TOKEN, { name: "Field Person", password: "longenough1" })).rejects.toMatchObject({ status: 410 });
    expect(db.nGOTeamMember.create).not.toHaveBeenCalled();
  });

  it("new user needs a name and an 8+ character password", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow());
    db.user.findUnique.mockResolvedValue(null);
    await expect(acceptInvite(TOKEN, { name: "A", password: "longenough1" })).rejects.toMatchObject({ status: 400 });
    await expect(acceptInvite(TOKEN, { name: "Field", password: "short" })).rejects.toMatchObject({ status: 400 });
  });

  it("existing user must be signed in AS the invitee", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow());
    db.user.findUnique.mockResolvedValue({ id: "u-ex", role: "DONOR", ngoProfile: null, teamMemberships: [] });
    await expect(acceptInvite(TOKEN, {})).rejects.toMatchObject({ status: 401, code: "SIGN_IN_REQUIRED" });
    await expect(acceptInvite(TOKEN, { sessionUserId: "someone-else" })).rejects.toMatchObject({ status: 403, code: "WRONG_ACCOUNT" });
    db.teamInvite.updateMany.mockResolvedValue({ count: 1 });
    const res = await acceptInvite(TOKEN, { sessionUserId: "u-ex" });
    expect(res).toMatchObject({ userId: "u-ex", newAccount: false });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.nGOTeamMember.create).toHaveBeenCalledWith({ data: { userId: "u-ex", ngoId: "ngo-A", role: "FIELD_STAFF" } });
  });

  it("existing user who runs another NGO or is an admin cannot join", async () => {
    db.teamInvite.findUnique.mockResolvedValue(pendingRow());
    db.user.findUnique.mockResolvedValue({ id: "u-ex", role: "NGO", ngoProfile: { id: "ngo-B" }, teamMemberships: [] });
    await expect(acceptInvite(TOKEN, { sessionUserId: "u-ex" })).rejects.toMatchObject({ status: 409 });
    db.user.findUnique.mockResolvedValue({ id: "u-ex", role: "ADMIN", ngoProfile: null, teamMemberships: [] });
    await expect(acceptInvite(TOKEN, { sessionUserId: "u-ex" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("member role changes respect the ceiling", () => {
  it("an ADMIN cannot promote anyone to OWNER", async () => {
    db.nGOTeamMember.findUnique.mockResolvedValue({ id: "m1", role: "FIELD_STAFF" });
    await expect(changeMemberRole(ADMIN, "u-2", "OWNER")).rejects.toMatchObject({ status: 403 });
    expect(db.nGOTeamMember.update).not.toHaveBeenCalled();
  });
  it("an ADMIN can make a field worker a program manager", async () => {
    db.nGOTeamMember.findUnique.mockResolvedValue({ id: "m1", role: "FIELD_STAFF" });
    await changeMemberRole(ADMIN, "u-2", "PROGRAM_MANAGER");
    expect(db.nGOTeamMember.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { role: "PROGRAM_MANAGER" } });
  });
});

describe("routes", () => {
  it("list responses never contain a token or its hash", async () => {
    db.nGOProfile.findUnique.mockImplementation(async (args: any) =>
      args.where.userId ? { id: "ngo-A" } : { orgName: "Akshar", user: { id: "owner-A", name: "O", email: "o@x.org" } }
    );
    db.nGOTeamMember.findMany.mockResolvedValue([]);
    db.teamInvite.findMany.mockResolvedValue([pendingRow()]);
    session.mockResolvedValue({ user: { id: "owner-A", role: "NGO" } });
    const res = await teamGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.invites).toHaveLength(1);
    expect(JSON.stringify(json)).not.toMatch(/tokenHash|token"/);
    // the select itself never asks for the secret columns
    expect(db.teamInvite.findMany.mock.calls[0][0].select).not.toHaveProperty("tokenHash");
    expect(db.teamInvite.findMany.mock.calls[0][0].select).not.toHaveProperty("token");
    const team = await listTeam("ngo-A");
    expect(team.members[0]).toMatchObject({ role: "OWNER" });
  });

  it("a field worker gets 403 inviting (server-side role check)", async () => {
    db.nGOProfile.findUnique.mockResolvedValue(null);
    db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-A", role: "FIELD_STAFF" });
    session.mockResolvedValue({ user: { id: "fw-1", role: "NGO" } });
    const res = await invitePOST(new Request("http://x/api/ngo/team/invites", { method: "POST", body: JSON.stringify({ email: "a@b.org", role: "FIELD_STAFF" }) }));
    expect(res.status).toBe(403);
    expect(db.teamInvite.create).not.toHaveBeenCalled();
  });

  it("an admin trying to invite above their own role is refused 403 ROLE_ABOVE_OWN", async () => {
    // ADMIN can grant ADMIN (equal) but OWNER is never invitable → 400; a FINANCE
    // member is not a manager at all → 403. Ceiling proper is unit-tested above.
    db.nGOProfile.findUnique.mockResolvedValue(null);
    db.nGOTeamMember.findFirst.mockResolvedValue({ ngoId: "ngo-A", role: "FINANCE" });
    session.mockResolvedValue({ user: { id: "fin-1", role: "NGO" } });
    const res = await invitePOST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "a@b.org", role: "ADMIN" }) }));
    expect(res.status).toBe(403);
  });

  it("revoke route: NGO B's invite id is 404 for NGO A", async () => {
    db.nGOProfile.findUnique.mockResolvedValue({ id: "ngo-A" });
    session.mockResolvedValue({ user: { id: "owner-A", role: "NGO" } });
    db.teamInvite.findUnique.mockResolvedValue(pendingRow({ ngoId: "ngo-B" }));
    const res = await revokePOST(new Request("http://x", { method: "POST" }), { params: { id: "inv-1" } });
    expect(res.status).toBe(404);
  });
});
