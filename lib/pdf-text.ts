/**
 * Server-only PDF text extraction. Never import from a "use client" module.
 *
 * Used by the rule-based extractors that run when no model key is configured
 * (or the model call fails): they need the real text of the document, and a
 * scanned PDF with no text layer must be reported as such — never guessed at.
 *
 * pdfjs-dist is listed in next.config.mjs serverComponentsExternalPackages so
 * it is loaded by Node at runtime rather than bundled by webpack.
 */

export type PdfTextErrorCode = "PDF_UNREADABLE" | "PDF_NO_TEXT" | "PDF_TOO_LARGE";

export class PdfTextError extends Error {
  constructor(public readonly code: PdfTextErrorCode, message: string) {
    super(message);
    this.name = "PdfTextError";
  }
}

export interface PdfText {
  /** Text of each page, in order. */
  pages: string[];
  /** All pages joined with blank lines. */
  text: string;
}

const MAX_PAGES = 60;

export async function extractPdfText(buffer: Buffer | Uint8Array): Promise<PdfText> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    throw new PdfTextError("PDF_UNREADABLE", "The PDF reader could not be loaded on the server.");
  }

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    // Text extraction needs no glyph rendering; keep font warnings out of logs.
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch {
    throw new PdfTextError("PDF_UNREADABLE", "The file is not a readable PDF (it may be corrupt or password-protected).");
  }

  try {
    if (doc.numPages > MAX_PAGES) {
      throw new PdfTextError("PDF_TOO_LARGE", `The PDF has ${doc.numPages} pages; the limit is ${MAX_PAGES}.`);
    }
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== "string") continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        } else {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line);
      pages.push(lines.map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n"));
    }
    const text = pages.join("\n\n").trim();
    if (!text) {
      throw new PdfTextError(
        "PDF_NO_TEXT",
        "The PDF has no text layer (it looks like a scan). Upload a text PDF or enter the details manually."
      );
    }
    return { pages, text };
  } finally {
    await task.destroy().catch(() => {});
  }
}
