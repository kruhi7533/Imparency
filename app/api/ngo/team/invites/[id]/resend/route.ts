import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { requireNgoMembership } from "@/lib/tenant-scope";
import { resendInvite } from "@/lib/ngo-team-invites";
import { inviteErrorResponse } from "../../../_errors";

/** NGO-003: resend = rotate the secret (old link dies) + extend 7 days. Own NGO's invites only (404 otherwise). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  const scope = await requireNgoMembership(session, null, "manageTeam");
  if (!scope.ok) return scope.response;
  try {
    return NextResponse.json(await resendInvite(scope.actor, params.id));
  } catch (err) {
    return inviteErrorResponse(err, "api/ngo/team/invites/resend");
  }
}
