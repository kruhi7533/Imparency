import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { logAdminAction } from "@/lib/admin-log";
import { prismaExportLookup, verifyExportedCsv } from "@/lib/audit-chain";
import { captureError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/admin/audit/verify-export — ADM-017 / NEG-013. Upload an exported
 * audit CSV (multipart field "file", or a text/csv body). Every row is
 * re-hashed offline, adjacent rows must link, seqs must descend and (for an
 * unfiltered export) be contiguous, and each row is cross-checked against the
 * database's record — so an edited, deleted or reordered row is reported with
 * its line and seq.
 */
export async function POST(request: Request) {
  const auth = await verifySessionRole("ADMIN");
  if (!auth.authorized) return auth.response;

  let text: string;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return NextResponse.json({ error: "Attach the exported CSV as 'file'." }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (25 MB max)." }, { status: 413 });
      text = await file.text();
    } else {
      text = await request.text();
      if (text.length > MAX_BYTES) return NextResponse.json({ error: "File too large (25 MB max)." }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file." }, { status: 400 });
  }
  if (!text.trim()) return NextResponse.json({ error: "The file is empty." }, { status: 400 });

  let result;
  try {
    result = await verifyExportedCsv(text, prismaExportLookup);
  } catch (err) {
    captureError(err, { scope: "api/admin/audit/verify-export", operation: "verify_export" });
    return NextResponse.json({ error: "Verification failed to run." }, { status: 500 });
  }

  await logAdminAction({
    adminId: auth.session.user.id,
    action: "AUDIT_EXPORT_VERIFIED",
    entityType: "SYSTEM",
    entityId: "audit-trail",
    metadata: {
      ok: result.ok,
      rowsChecked: result.rowsChecked,
      problemCount: result.problems.length,
      firstProblemSeq: result.problems[0]?.seq ?? null,
      firstProblemReason: result.problems[0]?.reason ?? null,
    },
    request,
  });

  return NextResponse.json(result);
}
