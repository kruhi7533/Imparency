import { NextResponse } from "next/server";
import { verifySessionRole } from "@/lib/auth-guards";
import { downloadReceipt } from "@/lib/receipt-service";

export const runtime = "nodejs";

/**
 * Authenticated 80G receipt download. All access flows through
 * ReceiptService.downloadReceipt() — permission check + audit event + bytes.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await verifySessionRole(); // any authenticated user; service checks ownership
  if (!auth.authorized) return auth.response;

  const result = await downloadReceipt(params.id, {
    userId: auth.session.user.id,
    role: auth.session.user.role,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new NextResponse(result.buffer as any, {
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
