import fs from "fs/promises";
import path from "path";
import { PRIVATE_UPLOAD_ROOT } from "@/lib/storage";

/**
 * Shared document loading for the agents that read stored NGO uploads
 * (lib/extraction-runner.ts).
 *
 * Kept separate from the runner so document loading has one definition, and so
 * a storage change lands in one place.
 */

export interface LoadedDocument {
  buffer: Buffer;
  mimeType: string;
}

export function guessMime(url: string): string {
  const ext = path.extname(url).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/pdf";
}

/**
 * Loads a stored document URL into a Buffer.
 * - Public local uploads ("/uploads/...") are read from the public folder.
 * - Private local uploads ("/api/documents/...") are read from PRIVATE_UPLOAD_ROOT.
 * - Anything else (S3/R2/CDN absolute URLs) is fetched over HTTP.
 * Returns null if the document cannot be loaded — callers turn that into a
 * flag rather than an exception, since one bad upload must not abort a run.
 */
export async function loadDocumentBuffer(url: string): Promise<LoadedDocument | null> {
  try {
    if (url.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), "public", url);
      const buffer = await fs.readFile(filePath);
      return { buffer, mimeType: guessMime(url) };
    }

    if (url.startsWith("/api/documents/")) {
      const relativePath = url.slice("/api/documents/".length);
      const root = path.resolve(process.cwd(), PRIVATE_UPLOAD_ROOT);
      const resolved = path.resolve(root, relativePath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        console.error(`Refusing to load document outside private root: ${url}`);
        return null;
      }
      const buffer = await fs.readFile(resolved);
      return { buffer, mimeType: guessMime(url) };
    }

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch document (${res.status}): ${url}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || guessMime(url);
    return { buffer: Buffer.from(arrayBuffer), mimeType: contentType };
  } catch (err) {
    console.error(`Error loading document ${url}:`, err);
    return null;
  }
}
