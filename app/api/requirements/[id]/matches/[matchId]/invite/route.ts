import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { inviteMatch } from "@/lib/requirements/workflow";
import { errorResponse } from "@/lib/requirements/http";

/** Owner/admin shares the sanitized opportunity brief with an eligible shortlisted NGO. */
export async function POST(_request: Request, { params }: { params: { id: string; matchId: string } }) {
  try {
    const actor = await requireActor();
    const match = await inviteMatch(params.id, actor, params.matchId);
    return NextResponse.json({ matchId: match.id, invitedAt: match.invitedAt });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/matches/[matchId]/invite");
  }
}
