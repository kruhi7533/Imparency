import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { cancelInvite, TeamError } from "@/lib/donor-team-admin";

/** DELETE: cancel a pending invitation. OWNER/ADMIN, own organisation only. */
export async function DELETE(_request: Request, { params }: { params: { inviteId: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  try {
    await cancelInvite(session.user.id, params.inviteId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/donor/team/invites] DELETE", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
