import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { requireNgoMembership } from "@/lib/tenant-scope";
import { revokeInvite } from "@/lib/ngo-team-invites";
import { inviteErrorResponse } from "../../../_errors";

/** NGO-003: revoke a pending invite (compare-and-swap). Own NGO's invites only (404 otherwise). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  const scope = await requireNgoMembership(session, null, "manageTeam");
  if (!scope.ok) return scope.response;
  try {
    await revokeInvite(scope.actor, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inviteErrorResponse(err, "api/ngo/team/invites/revoke");
  }
}
