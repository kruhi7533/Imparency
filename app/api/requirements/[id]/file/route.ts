import { NextResponse } from "next/server";
import { readPrivateFile } from "@/lib/storage";
import { requireActor, loadRequirementForActor } from "@/lib/requirements/access";
import { recordRequirementEventBestEffort } from "@/lib/requirements/audit";
import { RequirementWorkflowError } from "@/lib/requirements/errors";
import { ALLOWED_REQUIREMENT_MIME, INLINE_PREVIEW_MIME, safeDownloadName } from "@/lib/requirements/file-types";
import { errorResponse } from "@/lib/requirements/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ONLY way to read a CSR document. Authenticate → load → owner or admin
 * (NGOs and other donors get 403) → stream bytes from private storage.
 * The storage key/path is never exposed. ?download=1 forces a download.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const actor = await requireActor();
    const requirement = await loadRequirementForActor(params.id, actor);
    if (!requirement.storageKey) {
      throw new RequirementWorkflowError("The original document is not available.", 404);
    }

    let bytes: Buffer;
    try {
      bytes = await readPrivateFile(requirement.storageKey);
    } catch (err: any) {
      if (err?.code === "ENOENT" || err?.name === "NoSuchKey") {
        throw new RequirementWorkflowError("The original document is not available.", 404);
      }
      throw err;
    }

    const mime = ALLOWED_REQUIREMENT_MIME.has(requirement.mimeType) ? requirement.mimeType : "application/octet-stream";
    const forceDownload = new URL(request.url).searchParams.get("download") === "1";
    const disposition = !forceDownload && INLINE_PREVIEW_MIME.has(mime) ? "inline" : "attachment";
    const name = safeDownloadName(requirement.fileName);

    if (actor.role === "ADMIN") {
      await recordRequirementEventBestEffort({
        requirementId: requirement.id,
        action: "CSR_DOCUMENT_ACCESSED",
        actorId: actor.id,
        actorRole: "ADMIN",
        detail: `Admin ${disposition === "inline" ? "previewed" : "downloaded"} the original document.`,
      });
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${disposition}; filename="${name.ascii}"; filename*=UTF-8''${name.encoded}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    return errorResponse(err, "api/requirements/[id]/file");
  }
}
