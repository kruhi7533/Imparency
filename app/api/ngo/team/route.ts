import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { requireNgoMembership, ngoCan, INVITABLE_ROLES, canGrantRole } from "@/lib/tenant-scope";
import { listTeam } from "@/lib/ngo-team-invites";
import { inviteErrorResponse } from "./_errors";

/**
 * NGO-003: the caller's team — members and every invite with its state
 * (pending / accepted / expired / revoked). Any member may see it; the invite
 * list (emails) only goes to those who manage the team. Never a token.
 */
export async function GET() {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  const scope = await requireNgoMembership(session, null);
  if (!scope.ok) return scope.response;
  try {
    const team = await listTeam(scope.actor.ngoId);
    const canManage = ngoCan(scope.actor.teamRole, "manageTeam");
    return NextResponse.json({
      ...team,
      invites: canManage ? team.invites : [],
      me: {
        userId: scope.actor.userId,
        role: scope.actor.teamRole,
        canManage,
        grantableRoles: INVITABLE_ROLES.filter((r) => canGrantRole(scope.actor.teamRole, r)),
      },
    });
  } catch (err) {
    return inviteErrorResponse(err, "api/ngo/team GET");
  }
}
