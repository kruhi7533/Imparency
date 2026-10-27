import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { requireNgoMembership } from "@/lib/tenant-scope";
import { changeMemberRole, removeMember } from "@/lib/ngo-team-invites";
import { inviteErrorResponse } from "../../_errors";

/** Change a member's role (never above the caller's own). Members of the caller's NGO only. */
export async function PATCH(request: Request, { params }: { params: { userId: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  const scope = await requireNgoMembership(session, null, "manageTeam");
  if (!scope.ok) return scope.response;
  const body = await request.json().catch(() => ({}));
  try {
    await changeMemberRole(scope.actor, params.userId, body?.role);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inviteErrorResponse(err, "api/ngo/team/members PATCH");
  }
}

/** Remove a member (managers), or leave the team (self). */
export async function DELETE(_request: Request, { params }: { params: { userId: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  const scope = await requireNgoMembership(session, null);
  if (!scope.ok) return scope.response;
  try {
    await removeMember(scope.actor, params.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inviteErrorResponse(err, "api/ngo/team/members DELETE");
  }
}
