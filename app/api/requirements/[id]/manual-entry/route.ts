import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { startManualEntry } from "@/lib/requirements/workflow";
import { serializeRequirement } from "@/lib/requirements/dto";
import { errorResponse } from "@/lib/requirements/http";

/** Owner: extraction failed — fill the fields in by hand (FAILED → DONOR_REVIEW). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const updated = await startManualEntry(params.id, actor);
    return NextResponse.json({ requirement: serializeRequirement(updated, { includeRawText: true }) });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/manual-entry");
  }
}
