import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { runAndStoreNgoScreening } from "@/lib/screening-runner";

export const runtime = "nodejs";

/**
 * ADMIN-only. Runs (or re-runs) the NGO pre-screening agent and returns the
 * stored record. Used by the admin panel when screening is missing or stale.
 *
 * This endpoint ONLY surfaces a summary — it never changes NGO status.
 */
export async function POST(request: Request) {
  const { authorized, response } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  try {
    const { ngoId } = await request.json();
    if (!ngoId || typeof ngoId !== "string") {
      return NextResponse.json({ error: "ngoId is required" }, { status: 400 });
    }

    const screening = await runAndStoreNgoScreening(ngoId);
    if (!screening) {
      return NextResponse.json(
        { error: "Screening could not be run for this NGO" },
        { status: 500 }
      );
    }

    return NextResponse.json({ screening });
  } catch (err: any) {
    console.error("Screen-NGO route error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
