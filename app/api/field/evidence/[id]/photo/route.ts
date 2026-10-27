import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifySessionRole } from "@/lib/auth-guards";
import { isStorageError, readPrivateFile } from "@/lib/storage";
import { canViewEvidencePhoto, EVIDENCE_ACCESS_SELECT } from "@/lib/evidence-access";
import { signEvidencePhotoPath, verifyEvidencePhotoSignature } from "@/lib/evidence-photo-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * The only way to read a field photo (NEG-015). Two steps:
 *
 *   1. No `sig`: authorise the session, then 302 to a link signed for this
 *      viewer that expires in minutes (lib/evidence-photo-url.ts). Existing
 *      `<img src="/api/field/evidence/<id>/photo">` tags keep working.
 *   2. With `sig`: the signature must be valid, unexpired and issued to THIS
 *      session's user, and the access rule (lib/evidence-access.ts) is checked
 *      again — so rejecting the evidence or withdrawing consent revokes a link
 *      that was already issued.
 *
 * Anyone not allowed gets 404, so the id's existence is not disclosed. Bytes
 * are proxied from private storage; no storage-provider URL ever reaches the
 * browser.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { authorized, response, session } = await verifySessionRole();
    if (!authorized) return response;
    const user = session.user as { id: string; role: string };

    const evidence = await prisma.fieldEvidence.findUnique({
      where: { id: params.id },
      select: { ...EVIDENCE_ACCESS_SELECT, photoKey: true, photoMime: true },
    });
    const notFound = NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    if (!evidence) return notFound;

    const url = new URL(request.url);
    const sig = url.searchParams.get("sig");
    const exp = url.searchParams.get("exp");

    if (sig === null) {
      if (!(await canViewEvidencePhoto(user, evidence))) return notFound;
      const signed = signEvidencePhotoPath(params.id, user.id);
      return new NextResponse(null, { status: 302, headers: { ...NO_STORE, Location: signed.url } });
    }

    const check = verifyEvidencePhotoSignature(params.id, user.id, exp, sig);
    if (!check.ok) {
      return NextResponse.json(
        { error: check.code === "LINK_EXPIRED" ? "This photo link has expired. Reload the page." : "Invalid photo link.", code: check.code },
        { status: 403, headers: NO_STORE },
      );
    }
    // Re-check on every fetch: revocation must reach links already handed out.
    if (!(await canViewEvidencePhoto(user, evidence))) return notFound;

    const bytes = await readPrivateFile(evidence.photoKey);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": evidence.photoMime,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("[api/field/evidence/[id]/photo] GET error:", error);
    if ((error as { code?: string } | null)?.code === "ENOENT") {
      return NextResponse.json({ error: "Photo file not found.", code: "STORAGE_NOT_FOUND" }, { status: 404, headers: NO_STORE });
    }
    if (isStorageError(error)) {
      return NextResponse.json(
        { error: "The photo could not be loaded from storage.", code: error.code },
        { status: error.code === "STORAGE_NOT_FOUND" ? 404 : 502, headers: NO_STORE },
      );
    }
    return NextResponse.json({ error: "Failed to load photo", code: "PHOTO_READ_FAILED" }, { status: 500, headers: NO_STORE });
  }
}
