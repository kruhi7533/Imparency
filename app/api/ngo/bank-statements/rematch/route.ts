import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { BankStatementError, rematchForUser } from "@/lib/bank-statement";

/** Re-check every open statement line against pending payments — e.g. after a donor records one. */
export async function POST() {
  try {
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;
    return NextResponse.json(await rematchForUser(session.user));
  } catch (err) {
    if (err instanceof BankStatementError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/ngo/bank-statements/rematch] POST error:", err);
    return NextResponse.json({ error: "Could not re-run matching. Please try again." }, { status: 500 });
  }
}
