import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PRIVATE_UPLOAD_ROOT } from "@/lib/storage";
import { captureError } from "@/lib/observability";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only way to read a private upload.
 *
 * NGO registration certificates, PAN/12A/80G scans, FCRA certificates and
 * relief-initiative bank proofs used to be written into `public/uploads/`,
 * which Next serves as static assets — no session, no role, no ownership
 * check. Anyone holding (or guessing, or being forwarded) the URL could fetch
 * a scanned PAN card. An unguessable URL is not access control.
 *
 * Private uploads now live outside the web root and are addressed as
 * `/api/documents/<folder>/<file>`. This route authorises first and streams
 * second.
 *
 * Authorisation is intentionally narrow:
 *   ADMIN  — every document. Reviewing them is the job.
 *   NGO    — only files listed on its OWN NGOProfile.documents. Role is not
 *            ownership; being *an* NGO must never grant another org's papers.
 *   others — nothing.
 *
 * NOT covered, deliberately, and tracked as follow-ups:
 *   - The ~23 files already sitting in `public/uploads/` stay reachable until
 *     they are moved and their stored URLs rewritten. That is a data migration
 *     against a live database, not a code change.
 *   - Cloudinary/S3 return public URLs; `uploadFile` refuses private uploads on
 *     those providers rather than pretending. Signed URLs are the real fix.
 */
export async function GET(
  _request: Request,
  { params }: { params: { path: string[] } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const relativePath = (params.path || []).join("/");
  if (!relativePath) {
    return NextResponse.json({ error: "No document specified" }, { status: 400 });
  }

  // Path traversal guard. Resolve first, then confirm the result is still
  // inside the private root — string inspection of the raw segments is not
  // enough, since encodings and `..` combinations are easy to get wrong.
  const root = path.resolve(process.cwd(), PRIVATE_UPLOAD_ROOT);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "Invalid document path" }, { status: 400 });
  }

  const url = `/api/documents/${relativePath}`;
  const role = (session.user as any).role;

  if (role !== "ADMIN") {
    if (role !== "NGO") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Ownership, not role: this document must appear on the caller's own
    // profile. A different org's file resolves to no row and is refused.
    const owned = await prisma.nGOProfile.findFirst({
      where: { userId: session.user.id, documents: { has: url } },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let file: Buffer;
  try {
    file = await fs.readFile(resolved);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as any).code === "ENOENT") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    captureError(err, {
      scope: "api/documents",
      operation: "read_private_upload",
      userId: session.user.id,
      // Ids and shapes only — never the document contents or the file name,
      // which can itself carry an organisation's identity.
      extra: { segments: params.path.length },
    });
    return NextResponse.json({ error: "Failed to read document" }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": contentTypeFor(path.extname(resolved)),
      // Never let a shared cache hold a private document.
      "Cache-Control": "private, no-store, max-age=0",
      // Render inline where safe, but never let the browser sniff a document
      // into something executable.
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${path.basename(resolved).replace(/"/g, "")}"`,
    },
  });
}

function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      // Unknown types download rather than render, so an unexpected upload
      // cannot be coaxed into executing in the admin's browser.
      return "application/octet-stream";
  }
}
