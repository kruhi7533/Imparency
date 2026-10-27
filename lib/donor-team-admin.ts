import type { DonorTeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { logDonorEvent } from "@/lib/donor-events";
import { sendDonorTeamInviteEmail } from "@/lib/email";
import { donorCan, resolveDonorAccount, ROLE_FORBIDDEN } from "@/lib/donor-team";

/**
 * Managing a donor organisation's team: invite, change role, remove, and the
 * invite acceptance at signup. Access rules live in lib/donor-team.ts.
 *
 * Rules worth not breaking:
 * - Only OWNER/ADMIN manage the team, and only for their own account.
 * - A user belongs to at most one donor organisation, and a donor who already
 *   owns CSR work (requirements or contracts) cannot be added to another
 *   organisation — joining would hide their own records behind someone else's
 *   account. They are told why instead.
 * - Only donor accounts can join: an NGO or admin user is refused.
 * - Audit events carry ids and roles, never names or emails.
 */

export const TEAM_ROLES: DonorTeamRole[] = ["ADMIN", "APPROVER", "FINANCE", "VIEWER"];
const INVITE_DAYS = 7;

export class TeamError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireManager(actorUserId: string) {
  const account = await resolveDonorAccount(actorUserId);
  if (!donorCan(account.role, "manageTeam")) throw new TeamError(ROLE_FORBIDDEN, 403);
  return account;
}

export async function listTeam(accountId: string) {
  const [owner, members, invites] = await Promise.all([
    prisma.user.findUnique({ where: { id: accountId }, select: { id: true, name: true, email: true, companyName: true } }),
    prisma.donorTeamMember.findMany({ where: { accountId }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, role: true, createdAt: true } }),
    prisma.donorTeamInvite.findMany({
      where: { accountId, accepted: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, expiresAt: true },
    }),
  ]);
  const users = members.length
    ? await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true, email: true } })
    : [];
  return {
    orgName: owner?.companyName || owner?.name || "Your organisation",
    owner: owner ? { userId: owner.id, name: owner.name, email: owner.email } : null,
    members: members.map((m) => {
      const u = users.find((x) => x.id === m.userId);
      return { id: m.id, userId: m.userId, role: m.role, name: u?.name ?? null, email: u?.email ?? null, since: m.createdAt.toISOString() };
    }),
    invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() })),
  };
}

export async function inviteTeamMember(actorUserId: string, rawEmail: unknown, rawRole: unknown) {
  const account = await requireManager(actorUserId);
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) throw new TeamError("Enter a valid email address.", 400);
  if (!TEAM_ROLES.includes(rawRole as DonorTeamRole)) throw new TeamError("Choose a role: admin, approver, finance or viewer.", 400);
  const role = rawRole as DonorTeamRole;
  // Only the owner can create another admin; an admin cannot mint peers.
  if (role === "ADMIN" && account.role !== "OWNER") throw new TeamError("Only the account owner can add admins.", 403);

  const owner = await prisma.user.findUnique({ where: { id: account.accountId }, select: { companyName: true, name: true } });
  const orgName = owner?.companyName || owner?.name || "A donor organisation";
  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });

  if (existing) {
    if (existing.id === account.accountId) throw new TeamError("That is the account owner.", 400);
    if (existing.role !== "DONOR") throw new TeamError("Only donor accounts can join a donor organisation.", 400);
    const already = await prisma.donorTeamMember.findUnique({ where: { userId: existing.id }, select: { accountId: true } });
    if (already) {
      throw new TeamError(
        already.accountId === account.accountId ? "They are already on your team." : "That person already belongs to another donor organisation.",
        409
      );
    }
    const [reqs, contracts] = await Promise.all([
      prisma.sponsorRequirement.count({ where: { sponsorId: existing.id } }),
      prisma.contract.count({ where: { donorId: existing.id } }),
    ]);
    if (reqs + contracts > 0) {
      throw new TeamError("That account already has its own CSR requirements or contracts, so it cannot join another organisation.", 409);
    }
    const member = await prisma.donorTeamMember.create({
      data: { accountId: account.accountId, userId: existing.id, role, invitedById: actorUserId },
    });
    await logDonorEvent({ donorId: account.accountId, eventType: "TEAM_MEMBER_ADDED", newValue: { userId: existing.id, role }, initiatedBy: actorUserId, source: "USER" });
    await sendDonorTeamInviteEmail({ to: email, orgName, role, url: `${base}/donor/requirements`, hasAccount: true }).catch(() => {});
    return { added: true as const, memberId: member.id };
  }

  const invite = await prisma.donorTeamInvite.upsert({
    where: { email_accountId: { email, accountId: account.accountId } },
    create: { email, accountId: account.accountId, role, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
    update: { role, accepted: false, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
  });
  await logDonorEvent({ donorId: account.accountId, eventType: "TEAM_MEMBER_INVITED", newValue: { inviteId: invite.id, role }, initiatedBy: actorUserId, source: "USER" });
  await sendDonorTeamInviteEmail({ to: email, orgName, role, url: `${base}/login?invite=${invite.token}`, hasAccount: false }).catch(() => {});
  return { added: false as const, inviteId: invite.id };
}

export async function changeTeamRole(actorUserId: string, memberId: string, rawRole: unknown) {
  const account = await requireManager(actorUserId);
  if (!TEAM_ROLES.includes(rawRole as DonorTeamRole)) throw new TeamError("Choose a role: admin, approver, finance or viewer.", 400);
  const role = rawRole as DonorTeamRole;
  const member = await prisma.donorTeamMember.findUnique({ where: { id: memberId }, select: { accountId: true, userId: true, role: true } });
  if (!member || member.accountId !== account.accountId) throw new TeamError("Team member not found.", 404);
  if ((role === "ADMIN" || member.role === "ADMIN") && account.role !== "OWNER") throw new TeamError("Only the account owner can change an admin's role.", 403);
  if (member.userId === actorUserId) throw new TeamError("You cannot change your own role.", 400);
  await prisma.donorTeamMember.update({ where: { id: memberId }, data: { role } });
  await logDonorEvent({ donorId: account.accountId, eventType: "TEAM_ROLE_CHANGED", oldValue: { userId: member.userId, role: member.role }, newValue: { userId: member.userId, role }, initiatedBy: actorUserId, source: "USER" });
}

/** Managers remove members; any member may remove themselves (leave). */
export async function removeTeamMember(actorUserId: string, memberId: string) {
  const member = await prisma.donorTeamMember.findUnique({ where: { id: memberId }, select: { accountId: true, userId: true, role: true } });
  if (!member) throw new TeamError("Team member not found.", 404);
  if (member.userId !== actorUserId) {
    const account = await requireManager(actorUserId);
    if (member.accountId !== account.accountId) throw new TeamError("Team member not found.", 404);
    if (member.role === "ADMIN" && account.role !== "OWNER") throw new TeamError("Only the account owner can remove an admin.", 403);
  }
  await prisma.donorTeamMember.delete({ where: { id: memberId } });
  await logDonorEvent({ donorId: member.accountId, eventType: "TEAM_MEMBER_REMOVED", oldValue: { userId: member.userId, role: member.role }, initiatedBy: actorUserId, source: "USER" });
}

export async function cancelInvite(actorUserId: string, inviteId: string) {
  const account = await requireManager(actorUserId);
  const { count } = await prisma.donorTeamInvite.deleteMany({ where: { id: inviteId, accountId: account.accountId, accepted: false } });
  if (count === 0) throw new TeamError("Invitation not found.", 404);
}

/**
 * At signup: join the donor organisation that invited this email, if any.
 * Never throws — a failed join must not cost someone their new account.
 */
export async function acceptDonorInviteOnSignup(user: { id: string; email: string; role: string }, token?: string | null) {
  if (user.role !== "DONOR") return null;
  try {
    const email = user.email.trim().toLowerCase();
    const invite = await prisma.donorTeamInvite.findFirst({
      where: { email, accepted: false, expiresAt: { gt: new Date() }, ...(token ? { token } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (!invite) return null;
    // Accept exactly once even if two signups race on the same invite.
    const { count } = await prisma.donorTeamInvite.updateMany({ where: { id: invite.id, accepted: false }, data: { accepted: true } });
    if (count === 0) return null;
    await prisma.donorTeamMember.create({ data: { accountId: invite.accountId, userId: user.id, role: invite.role, invitedById: invite.accountId } });
    await logDonorEvent({ donorId: invite.accountId, eventType: "TEAM_MEMBER_ADDED", newValue: { userId: user.id, role: invite.role }, initiatedBy: user.id, source: "USER" });
    return { accountId: invite.accountId, role: invite.role };
  } catch (err) {
    console.warn("[signup] donor team invite accept failed:", err);
    return null;
  }
}
