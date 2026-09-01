import fs from "fs/promises";
import path from "path";

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
 * - Local uploads ("/uploads/...") are read from the public folder.
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
