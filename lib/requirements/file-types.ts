/**
 * Upload type validation for CSR documents. The extension must be allowlisted
 * AND the file's leading bytes must match that format — the client-supplied
 * MIME type is ignored, so a renamed executable/HTML file is rejected.
 */
export const MAX_REQUIREMENT_FILE_BYTES = 10 * 1024 * 1024;

const startsWith = (b: Buffer, bytes: number[], offset = 0) => bytes.every((x, i) => b[offset + i] === x);

const FILE_TYPES: Record<string, { mime: string; matches: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", matches: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  },
  png: { mime: "image/png", matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: "image/jpeg", matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  webp: {
    mime: "image/webp",
    matches: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
};

/** MIME types that may be served inline for preview (everything else downloads). */
export const INLINE_PREVIEW_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
export const ALLOWED_REQUIREMENT_MIME = new Set(Object.values(FILE_TYPES).map((t) => t.mime));

export function detectRequirementFileType(fileName: string, buffer: Buffer): { ext: string; mime: string } | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const type = FILE_TYPES[ext];
  if (!type || !type.matches(buffer)) return null;
  return { ext, mime: type.mime };
}

/** A filename safe for a Content-Disposition header (the stored name is never trusted). */
export function safeDownloadName(fileName: string): { ascii: string; encoded: string } {
  const cleaned = (fileName || "document").replace(/[\r\n"\\/]/g, "_").slice(0, 150);
  return { ascii: cleaned.replace(/[^\x20-\x7e]/g, "_"), encoded: encodeURIComponent(cleaned) };
}
