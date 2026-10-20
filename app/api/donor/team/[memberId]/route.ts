import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { verifySessionRole } from "@/lib/auth-guards";
import { changeTeamRole, removeTeamMember, TeamError } from "@/lib/donor-team-admin";

const fail = (err: unknown, what: string) => {
  if (err instanceof TeamError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(`[api/donor/team/[memberId]] ${what}`, err);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
};

/** PATCH { role }: change a member's role. OWNER/ADMIN, own organisation only. */
export async function PATCH(request: Request, { params }: { params: { memberId: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  const body = await request.json().catch(() => ({}));
  try {
    await changeTeamRole(session.user.id, params.memberId, body?.role);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err, "PATCH");
  }
}

/** DELETE: remove a member (managers), or leave the organisation (yourself). */
export async function DELETE(_request: Request, { params }: { params: { memberId: string } }) {
  const { authorized, response, session } = await verifySessionRole(Role.DONOR);
  if (!authorized) return response;
  try {
    await removeTeamMember(session.user.id, params.memberId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err, "DELETE");
  }
}
