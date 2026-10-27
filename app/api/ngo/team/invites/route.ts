import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { requireNgoMembership } from "@/lib/tenant-scope";
import { createInvite } from "@/lib/ngo-team-invites";
import { checkRateLimit } from "@/lib/rate-limiter";
import { inviteErrorResponse } from "../_errors";

/**
 * NGO-003: invite someone to the caller's NGO. OWNER/ADMIN only, never above
 * their own role. `inviteUrl` is present only when no email went out.
 */
export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.NGO);
  if (!authorized) return response;
  const rl = await checkRateLimit(request, "ngo/team/invites", 30, 3600);
  if (rl.isBlocked) return rl.response;
  const scope = await requireNgoMembership(session, null, "manageTeam");
  if (!scope.ok) return scope.response;
  const body = await request.json().catch(() => ({}));
  try {
    const result = await createInvite(scope.actor, body?.email, body?.role);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return inviteErrorResponse(err, "api/ngo/team/invites POST");
  }
}
