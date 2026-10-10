import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limiter";
import { BankStatementError, importBankStatement, loadReconciliationView, MAX_STATEMENT_BYTES } from "@/lib/bank-statement";

export const runtime = "nodejs";

/** The NGO's statement imports, credit lines and still-pending contract payments. */
export async function GET() {
  const { authorized, response, session } = await verifySessionRole("NGO");
  if (!authorized) return response;
  const view = await loadReconciliationView(session.user);
  if (!view) return NextResponse.json({ error: "Your account is not linked to an NGO." }, { status: 403 });
  return NextResponse.json(view);
}

/**
 * Upload a bank statement CSV (multipart field "file"). Lines already imported
 * are skipped; every open credit line is then matched against pending MANUAL
 * contract payments, and clear matches are reconciled.
 */
export async function POST(request: Request) {
  try {
    const { isBlocked, response: limited } = await checkRateLimit(request, "bank-statement-upload", 10, 300);
    if (isBlocked && limited) return limited;
    const { authorized, response, session } = await verifySessionRole("NGO");
    if (!authorized) return response;

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Attach the statement as a CSV file." }, { status: 400 });
    }
    if (file.size > MAX_STATEMENT_BYTES) {
      return NextResponse.json({ error: "The statement is larger than 1 MB — upload a shorter date range." }, { status: 400 });
    }
    if (!/\.csv$/i.test(file.name) && file.type && !/csv|text\/plain|excel/i.test(file.type)) {
      return NextResponse.json({ error: "Upload the statement as a .csv file (most banks offer a CSV export)." }, { status: 400 });
    }
    const result = await importBankStatement({ user: session.user, fileName: file.name, content: await file.text() });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof BankStatementError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[api/ngo/bank-statements] POST error:", err);
    return NextResponse.json({ error: "Could not process the statement. Please try again." }, { status: 500 });
  }
}
