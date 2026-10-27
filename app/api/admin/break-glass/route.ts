import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { BreakGlassError, listGrants, requestGrant } from "@/lib/break-glass";

export const runtime = "nodejs";

/** ADM-020. GET: grants (SUPPORT: own; SUPER/AUDITOR: all). POST: a SUPPORT admin opens a grant. */
export async function GET() {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  try {
    return NextResponse.json({ grants: await listGrants(session.user) });
  } catch {
    return NextResponse.json({ error: "Could not load grants." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  const body = await request.json().catch(() => ({}));
  try {
    const grant = await requestGrant(session.user, body ?? {}, request);
    return NextResponse.json(
      { grant: { id: grant.id, orgType: grant.orgType, orgId: grant.orgId, expiresAt: grant.expiresAt.toISOString() } },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof BreakGlassError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[admin/break-glass] POST failed");
    return NextResponse.json({ error: "Could not open the grant." }, { status: 500 });
  }
}
