import prisma from "@/lib/prisma";

/**
 * Donor organisations with more than one person (roadmap row 6, "team roles").
 *
 * The CSR account is the owner's User row. Requirements (`sponsorId`),
 * contracts (`donorId`) and organisation verification all stay keyed on that
 * id — nothing is re-keyed. A team member ACTS FOR the account, with a role:
 *
 *   OWNER     the account itself — everything
 *   ADMIN     everything except removing the owner
 *   APPROVER  decides: shortlists, approves proposals, signs, records payments
 *   FINANCE   records and releases payments and sees finance; decides nothing
 *             (cannot approve a proposal, sign, edit a requirement) — DON-002
 *   VIEWER    reads everything, changes nothing
 *
 * Every donor-side ownership check goes through `resolveDonorAccount` /
 * `donorActsFor`: "is this user the donor on this row?" becomes "does this
 * user act for the account that owns this row, with this capability?".
 * Donations stay personal — they are an individual's money, not the company's.
 */

export type DonorRole = "OWNER" | "ADMIN" | "APPROVER" | "FINANCE" | "VIEWER";

export type DonorCapability =
  /** See the account's requirements, contracts, reports. */
  | "view"
  /** Create, edit, submit and withdraw CSR requirements. */
  | "editRequirements"
  /** Run matching, invite NGOs, request changes, approve a proposal, sign and propose contracts. */
  | "decide"
  /** Record and release payments. */
  | "pay"
  /** Terminate a contract. */
  | "terminate"
  /** Invite, change and remove team members. */
  | "manageTeam";

const CAN: Record<DonorCapability, DonorRole[]> = {
  view: ["OWNER", "ADMIN", "APPROVER", "FINANCE", "VIEWER"],
  editRequirements: ["OWNER", "ADMIN"],
  decide: ["OWNER", "ADMIN", "APPROVER"],
  pay: ["OWNER", "ADMIN", "APPROVER", "FINANCE"],
  terminate: ["OWNER", "ADMIN"],
  manageTeam: ["OWNER", "ADMIN"],
};

export function donorCan(role: DonorRole, cap: DonorCapability): boolean {
  return CAN[cap].includes(role);
}

export interface DonorAccount {
  /** The CSR account (owner's user id) this user acts for. */
  accountId: string;
  role: DonorRole;
}

/** Which account a donor-role user acts for. Not a member of any → their own, as OWNER. */
export async function resolveDonorAccount(userId: string): Promise<DonorAccount> {
  const membership = await prisma.donorTeamMember.findUnique({ where: { userId }, select: { accountId: true, role: true } });
  return membership ? { accountId: membership.accountId, role: membership.role } : { accountId: userId, role: "OWNER" };
}

/**
 * Does this user act for `donorId` with `cap`? Returns the role when yes.
 * A row owned by any other account is `null` — callers turn that into the same
 * 403/404 they already return for "not your row".
 */
export async function donorActsFor(userId: string, donorId: string, cap: DonorCapability = "view"): Promise<DonorRole | null> {
  const account = await resolveDonorAccount(userId);
  if (account.accountId !== donorId) return null;
  return donorCan(account.role, cap) ? account.role : null;
}

/** The message for a member whose role does not allow an action on their own account's row. */
export const ROLE_FORBIDDEN = "Your role on this organisation does not allow this action. Ask an owner or admin.";

/**
 * Like donorActsFor, but tells "not your row" (null → 404/403 as the caller
 * prefers) apart from "your row, but your role cannot" (403 with a reason).
 */
export async function checkDonorAction(
  userId: string,
  donorId: string,
  cap: DonorCapability
): Promise<{ ok: true; role: DonorRole } | { ok: false; reason: "not_party" | "role" }> {
  const account = await resolveDonorAccount(userId);
  if (account.accountId !== donorId) return { ok: false, reason: "not_party" };
  if (!donorCan(account.role, cap)) return { ok: false, reason: "role" };
  return { ok: true, role: account.role };
}
