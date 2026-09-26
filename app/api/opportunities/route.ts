import { NextResponse } from "next/server";
import { requireActor } from "@/lib/requirements/access";
import { listOpportunitiesForNgo } from "@/lib/requirements/opportunities";
import { errorResponse } from "@/lib/requirements/http";

/** NGO: sanitized briefs for CSR opportunities this NGO was invited to. */
export async function GET() {
  try {
    const actor = await requireActor();
    return NextResponse.json({ opportunities: await listOpportunitiesForNgo(actor) });
  } catch (err) {
    return errorResponse(err, "api/opportunities GET");
  }
}
