import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { TeamRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sendNgoTeamInviteEmail } from "@/lib/email";
import {
  INVITABLE_ROLES,
  TEAM_ROLE_LABEL,
  canGrantRole,
  ngoCan,
  type NgoMembership,
} from "@/lib/tenant-scope";

/**
 * NGO-003 — NGO team invitations.
 *
 * Rules worth not breaking:
 * - The secret is 32 random bytes, base64url. Only its sha256 is stored
 *   (`TeamInvite.tokenHash`); the secret exists in the email and, when no email
 *   could be sent, in the ONE response to the inviter that created/resent it.
 *   It never appears in list responses or logs (mock email withholds the body).
 * - Single use: acceptance is a compare-and-swap on status PENDING + tokenHash
 *   + unexpired, inside the same transaction that creates the membership.
 * - Resend rotates the secret: the old link stops working.
 * - Nobody grants a role above their own (lib/tenant-scope.ts canGrantRole);
 *   OWNER is never invitable.
 * - An existing account must be SIGNED IN as the invited email to accept —
 *   holding the link is not enough to attach someone else's account.
 * - "Not sent" is reported honestly: with no email provider configured the
 *   inviter gets `emailSent: false` and a copyable link instead.
 */

export const INVITE_DAYS = 7;
const RESEND_COOLDOWN_MS = 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InviteError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type InviteState = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export function inviteState(row: { status: string; accepted?: boolean; expiresAt: Date }, now = new Date()): InviteState {
  if (row.status === "ACCEPTED" || row.accepted) return "ACCEPTED";
  if (row.status === "REVOKED") return "REVOKED";
  if (row.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "PENDING";
}

function baseUrl() {
  return (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}
export function acceptUrlFor(token: string) {
  return `${baseUrl()}/invite/${token}`;
}

/** What an inviter may see about an invite. No token, no hash. */
const SAFE_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  accepted: true,
  createdAt: true,
  expiresAt: true,
  lastSentAt: true,
  sendCount: true,
  acceptedAt: true,
  revokedAt: true,
} as const;

function toSafe(row: any, now = new Date()) {
  return {
    id: row.id as string,
    email: row.email as string,
    role: row.role as TeamRole,
    state: inviteState(row, now),
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    lastSentAt: row.lastSentAt ? new Date(row.lastSentAt).toISOString() : null,
    sendCount: row.sendCount ?? 0,
    acceptedAt: row.acceptedAt ? new Date(row.acceptedAt).toISOString() : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
  };
}
export type SafeInvite = ReturnType<typeof toSafe>;

function requireManager(actor: NgoMembership) {
  if (!ngoCan(actor.teamRole, "manageTeam")) {
    throw new InviteError("Only the NGO owner or an admin can manage the team.", 403, "TEAM_ROLE_FORBIDDEN");
  }
}

export async function listTeam(ngoId: string) {
  const [ngo, members, invites] = await Promise.all([
    prisma.nGOProfile.findUnique({ where: { id: ngoId }, select: { orgName: true, user: { select: { id: true, name: true, email: true } } } }),
    prisma.nGOTeamMember.findMany({
      where: { ngoId },
      orderBy: { createdAt: "asc" },
      select: { role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
    }),
    prisma.teamInvite.findMany({ where: { ngoId }, orderBy: { createdAt: "desc" }, select: SAFE_SELECT }),
  ]);
  const now = new Date();
  const memberRows = members.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    since: m.createdAt.toISOString(),
  }));
  // The NGOProfile owner is always on the team, whether or not a row exists.
  if (ngo?.user && !memberRows.some((m) => m.userId === ngo.user.id)) {
    memberRows.unshift({ userId: ngo.user.id, name: ngo.user.name, email: ngo.user.email, role: "OWNER", since: "" });
  }
  return {
    orgName: ngo?.orgName ?? "Your NGO",
    members: memberRows,
    invites: invites.map((i) => toSafe(i, now)),
  };
}

async function deliver(invite: { email: string; role: TeamRole; expiresAt: Date }, ngoId: string, token: string) {
  const ngo = await prisma.nGOProfile.findUnique({ where: { id: ngoId }, select: { orgName: true } });
  const acceptUrl = acceptUrlFor(token);
  let sent = false;
  try {
    const res: any = await sendNgoTeamInviteEmail({
      to: invite.email,
      ngoName: ngo?.orgName || "An NGO",
      roleLabel: TEAM_ROLE_LABEL[invite.role],
      acceptUrl,
      expiresAt: invite.expiresAt,
    });
    sent = !!res?.success && !res?.mock;
  } catch {
    sent = false;
  }
  // The link goes back ONLY when the email did not: the inviter is then the
  // delivery channel. A delivered invite's secret is never returned.
  return sent
    ? { emailSent: true as const }
    : {
        emailSent: false as const,
        emailNote: "No email was sent (no email provider is configured, or delivery failed). Copy the link and send it to the invitee yourself — it is shown only now.",
        inviteUrl: acceptUrl,
      };
}

export async function createInvite(actor: NgoMembership, rawEmail: unknown, rawRole: unknown) {
  requireManager(actor);
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) throw new InviteError("Enter a valid email address.", 400);
  if (!INVITABLE_ROLES.includes(rawRole as TeamRole)) {
    throw new InviteError("Choose a role: Admin, Program Manager, Finance or Field Worker.", 400);
  }
  const role = rawRole as TeamRole;
  if (!canGrantRole(actor.teamRole, role)) {
    throw new InviteError("You cannot invite someone to a role above your own.", 403, "ROLE_ABOVE_OWN");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, ngoProfile: { select: { id: true } } },
  });
  if (user) {
    if (user.ngoProfile?.id === actor.ngoId) throw new InviteError("That is the NGO's owner.", 409);
    const member = await prisma.nGOTeamMember.findUnique({ where: { userId_ngoId: { userId: user.id, ngoId: actor.ngoId } }, select: { id: true } });
    if (member) throw new InviteError("They are already on your team.", 409, "ALREADY_MEMBER");
  }

  const existing = await prisma.teamInvite.findUnique({ where: { email_ngoId: { email, ngoId: actor.ngoId } } });
  if (existing && inviteState(existing) === "PENDING") {
    throw new InviteError("An invitation to this email is already pending. Resend or revoke it instead.", 409, "INVITE_PENDING");
  }

  const { token, tokenHash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  const now = new Date();
  // One row per (email, ngo): an expired, revoked or previously accepted
  // (member since removed) invite is reset with a fresh secret.
  const data = {
    role,
    tokenHash,
    status: "PENDING" as const,
    accepted: false,
    invitedById: actor.userId,
    expiresAt,
    acceptedAt: null,
    acceptedUserId: null,
    revokedAt: null,
    revokedById: null,
    lastSentAt: now,
    sendCount: 1,
  };
  const row = existing
    ? await prisma.teamInvite.update({ where: { id: existing.id }, data, select: SAFE_SELECT })
    : await prisma.teamInvite.create({ data: { ...data, email, ngoId: actor.ngoId }, select: SAFE_SELECT });

  const delivery = await deliver({ email, role, expiresAt }, actor.ngoId, token);
  return { invite: toSafe(row), ...delivery };
}

async function loadOwnInvite(actor: NgoMembership, inviteId: string) {
  const row = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
  // Another NGO's invite is indistinguishable from a missing one.
  if (!row || row.ngoId !== actor.ngoId) throw new InviteError("Invitation not found.", 404);
  return row;
}

export async function resendInvite(actor: NgoMembership, inviteId: string) {
  requireManager(actor);
  const row = await loadOwnInvite(actor, inviteId);
  const state = inviteState(row);
  if (state === "ACCEPTED") throw new InviteError("This invitation was already accepted.", 409);
  if (state === "REVOKED") throw new InviteError("This invitation was revoked. Send a new one instead.", 409);
  if (!canGrantRole(actor.teamRole, row.role)) throw new InviteError("You cannot resend an invite for a role above your own.", 403);
  if (row.lastSentAt && Date.now() - row.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new InviteError("This invitation was just sent. Wait a minute before resending.", 429);
  }
  const { token, tokenHash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  // Compare-and-swap on the hash we read: a concurrent accept/revoke wins.
  const { count } = await prisma.teamInvite.updateMany({
    where: { id: row.id, status: "PENDING", tokenHash: row.tokenHash },
    data: { tokenHash, expiresAt, lastSentAt: new Date(), sendCount: { increment: 1 } },
  });
  if (count === 0) throw new InviteError("The invitation changed while resending. Refresh and try again.", 409);
  const fresh = await prisma.teamInvite.findUnique({ where: { id: row.id }, select: SAFE_SELECT });
  const delivery = await deliver({ email: row.email, role: row.role, expiresAt }, actor.ngoId, token);
  return { invite: toSafe(fresh), ...delivery };
}

export async function revokeInvite(actor: NgoMembership, inviteId: string) {
  requireManager(actor);
  const row = await loadOwnInvite(actor, inviteId);
  const state = inviteState(row);
  if (state === "ACCEPTED") throw new InviteError("This invitation was already accepted. Remove the member instead.", 409);
  if (state === "REVOKED") throw new InviteError("This invitation is already revoked.", 409);
  const { count } = await prisma.teamInvite.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "REVOKED", revokedAt: new Date(), revokedById: actor.userId },
  });
  if (count === 0) throw new InviteError("The invitation changed. Refresh and try again.", 409);
}

// ─── The invitee's side ──────────────────────────────────────────────────────

const REFUSALS: Record<Exclude<InviteState, "PENDING">, { status: number; message: string }> = {
  ACCEPTED: { status: 410, message: "This invitation has already been used." },
  REVOKED: { status: 410, message: "This invitation was withdrawn by the NGO." },
  EXPIRED: { status: 410, message: "This invitation has expired. Ask the NGO to resend it." },
};

async function findByToken(token: unknown) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  return prisma.teamInvite.findUnique({ where: { tokenHash: hashInviteToken(token) } });
}

/** What the accept page shows. An unknown token reveals nothing. */
export async function lookupInvite(token: unknown) {
  const row = await findByToken(token);
  if (!row) return { state: "INVALID" as const };
  const state = inviteState(row);
  if (state !== "PENDING") return { state };
  const [ngo, user] = await Promise.all([
    prisma.nGOProfile.findUnique({ where: { id: row.ngoId }, select: { orgName: true } }),
    prisma.user.findUnique({ where: { email: row.email }, select: { id: true } }),
  ]);
  return {
    state,
    ngoName: ngo?.orgName ?? "An NGO",
    role: row.role,
    roleLabel: TEAM_ROLE_LABEL[row.role],
    email: row.email,
    hasAccount: !!user,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function acceptInvite(
  token: unknown,
  opts: { sessionUserId?: string | null; name?: unknown; password?: unknown }
) {
  const row = await findByToken(token);
  if (!row) throw new InviteError("This invitation link is not valid.", 404, "INVALID");
  const state = inviteState(row);
  if (state !== "PENDING") throw new InviteError(REFUSALS[state].message, REFUSALS[state].status, state);

  const existing = await prisma.user.findUnique({
    where: { email: row.email },
    select: { id: true, role: true, ngoProfile: { select: { id: true } }, teamMemberships: { select: { ngoId: true } } },
  });

  const claim = (tx: any, userId: string) =>
    tx.teamInvite.updateMany({
      where: { id: row.id, status: "PENDING", tokenHash: row.tokenHash, expiresAt: { gt: new Date() } },
      data: { status: "ACCEPTED", accepted: true, acceptedAt: new Date(), acceptedUserId: userId },
    });

  if (existing) {
    if (!opts.sessionUserId) {
      throw new InviteError(`Sign in as ${row.email} to accept this invitation.`, 401, "SIGN_IN_REQUIRED");
    }
    if (opts.sessionUserId !== existing.id) {
      throw new InviteError("This invitation is for a different account. Sign out and sign in with the invited email.", 403, "WRONG_ACCOUNT");
    }
    if (existing.role === "ADMIN") throw new InviteError("Platform admin accounts cannot join an NGO team.", 409);
    if (existing.ngoProfile && existing.ngoProfile.id !== row.ngoId) {
      throw new InviteError("This account already runs another NGO, so it cannot join this one.", 409);
    }
    if (existing.teamMemberships.some((m) => m.ngoId !== row.ngoId)) {
      throw new InviteError("This account already belongs to another NGO's team.", 409);
    }
    if (existing.teamMemberships.some((m) => m.ngoId === row.ngoId) || existing.ngoProfile?.id === row.ngoId) {
      throw new InviteError("You are already on this team.", 409, "ALREADY_MEMBER");
    }
    await prisma.$transaction(async (tx) => {
      const { count } = await claim(tx, existing.id);
      if (count === 0) throw new InviteError("This invitation has already been used.", 410, "ACCEPTED");
      await tx.nGOTeamMember.create({ data: { userId: existing.id, ngoId: row.ngoId, role: row.role } });
    });
    return { userId: existing.id, ngoId: row.ngoId, role: row.role, newAccount: false };
  }

  const name = typeof opts.name === "string" ? opts.name.trim() : "";
  const password = typeof opts.password === "string" ? opts.password : "";
  if (name.length < 2 || name.length > 100) throw new InviteError("Enter your name.", 400);
  if (password.length < 8 || password.length > 200) throw new InviteError("Choose a password of at least 8 characters.", 400);
  const passwordHash = await bcrypt.hash(password, 10);

  const userId = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: row.email, name, passwordHash, role: "NGO" } });
    const { count } = await claim(tx, user.id);
    if (count === 0) throw new InviteError("This invitation has already been used.", 410, "ACCEPTED");
    await tx.nGOTeamMember.create({ data: { userId: user.id, ngoId: row.ngoId, role: row.role } });
    return user.id;
  });
  return { userId, ngoId: row.ngoId, role: row.role, newAccount: true, email: row.email };
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function changeMemberRole(actor: NgoMembership, userId: string, rawRole: unknown) {
  requireManager(actor);
  if (!INVITABLE_ROLES.includes(rawRole as TeamRole) && rawRole !== "OWNER") throw new InviteError("Invalid role.", 400);
  const role = rawRole as TeamRole;
  if (userId === actor.userId) throw new InviteError("You cannot change your own role.", 400);
  const member = await prisma.nGOTeamMember.findUnique({ where: { userId_ngoId: { userId, ngoId: actor.ngoId } } });
  if (!member) throw new InviteError("Team member not found.", 404);
  if (!canGrantRole(actor.teamRole, member.role)) throw new InviteError("You cannot change the role of someone above you.", 403);
  if (!canGrantRole(actor.teamRole, role)) throw new InviteError("You cannot give a role above your own.", 403, "ROLE_ABOVE_OWN");
  await prisma.nGOTeamMember.update({ where: { id: member.id }, data: { role } });
}

export async function removeMember(actor: NgoMembership, userId: string) {
  const self = userId === actor.userId;
  if (!self) requireManager(actor);
  const member = await prisma.nGOTeamMember.findUnique({ where: { userId_ngoId: { userId, ngoId: actor.ngoId } } });
  if (!member) throw new InviteError("Team member not found.", 404);
  if (member.role === "OWNER") throw new InviteError("The owner cannot be removed here.", 403);
  if (!self && !canGrantRole(actor.teamRole, member.role)) throw new InviteError("You cannot remove someone above you.", 403);
  await prisma.nGOTeamMember.delete({ where: { id: member.id } });
}
