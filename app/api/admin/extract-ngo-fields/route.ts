import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import { runAndStoreNgoExtraction } from "@/lib/extraction-runner";

export const runtime = "nodejs";

/**
 * ADMIN-only. Runs (or re-runs) field-level document extraction for one NGO.
 *
 * This only produces evidence — it never changes NGO
 * verification status or any compliance flag. Flags are only ever set by an
 * admin validating a field (admin/ngo-fields/[fieldId]) and then approving.
 *
 * Re-running preserves admin decisions whose extracted value is unchanged; a
 * changed value resets the field, because the old validation was about a
 * different value.
 */
export async function POST(request: Request) {
  const { authorized, response } = await verifySessionRole("ADMIN");
  if (!authorized) return response;

  // Rate-limited: each run is a multi-document Gemini call.
  const rl = await checkRateLimit(request, "admin/extract-ngo-fields", 20, 60);
  if (rl.isBlocked) return rl.response!;

  try {
    const { ngoId } = await request.json();
    if (!ngoId || typeof ngoId !== "string") {
      return NextResponse.json({ error: "ngoId is required" }, { status: 400 });
    }

    const fields = await runAndStoreNgoExtraction(ngoId);
    if (!fields) {
      return NextResponse.json(
        {
          error:
            "Extraction could not be completed. Every field has been left in review so it can be entered manually.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ fields });
  } catch (err: any) {
    console.error("Extract-NGO-fields route error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
