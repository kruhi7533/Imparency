import { checkRateLimit } from "@/lib/rate-limiter";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { resolveDonorAccount } from "@/lib/donor-team";
import { inviteTeamMember, listTeam, TeamError } from "@/lib/donor-team-admin";

/** GET: the caller's donor organisation team (any member may see who is on it). */
export async function GET() {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  const account = await resolveDonorAccount(session.user.id);
  return NextResponse.json({ ...(await listTeam(account.accountId)), myRole: account.role });
}

/** POST { email, role }: invite or add a member. OWNER/ADMIN only. */
export async function POST(request: Request) {
  const rl = await checkRateLimit(request, "donor/team-invite", 20, 3600);
  if (rl.isBlocked) return rl.response;
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await inviteTeamMember(session.user.id, body?.email, body?.role), { status: 201 });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/donor/team] POST", err);
    return NextResponse.json({ error: "Could not add the team member." }, { status: 500 });
  }
}
