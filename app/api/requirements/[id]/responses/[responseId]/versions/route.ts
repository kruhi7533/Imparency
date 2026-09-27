import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { listResponseRevisions } from "@/lib/requirements/queries";
import { errorResponse } from "@/lib/requirements/http";

/** Superseded versions of one NGO proposal, newest first — owner, admin, or the owning NGO. */
export async function GET(_request: Request, { params }: { params: { id: string; responseId: string } }) {
  try {
    const actor = await requireActor();
    return NextResponse.json({ revisions: await listResponseRevisions(params.id, params.responseId, actor) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/responses/[responseId]/versions");
  }
}
