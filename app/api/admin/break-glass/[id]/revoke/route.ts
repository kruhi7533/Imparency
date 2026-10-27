import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { BreakGlassError, revokeGrant } from "@/lib/break-glass";

export const runtime = "nodejs";

/** ADM-020: end a grant early. The holder or a SUPER admin. Logged as BREAK_GLASS_REVOKED. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.ADMIN);
  if (!authorized) return response;
  try {
    await revokeGrant(session.user, params.id, request);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BreakGlassError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[admin/break-glass/revoke] failed");
    return NextResponse.json({ error: "Could not revoke the grant." }, { status: 500 });
  }
}
