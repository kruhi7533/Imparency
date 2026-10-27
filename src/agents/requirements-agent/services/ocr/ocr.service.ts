import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
// pdfjs-dist v6 needs Promise.withResolvers (Node 22+); CI/Vercel may run Node 20.
import '@/lib/promise-polyfills';

/*
 * Every parser is loaded LAZILY, inside the call that needs it. These used to be
 * top-level imports, which meant a module that cannot load in the serverless
 * runtime (pdfjs-dist needs DOMMatrix, @napi-rs/canvas is a native binary,
 * tesseract.js spawns workers) crashed the whole upload route at import time —
 * Next.js then answers 500 with an EMPTY body, before any handler code runs.
 * Loaded here, a failure is an ordinary error that the extraction pipeline
 * classifies (DOCUMENT_PARSER_UNAVAILABLE) and reports.
 */

/** Thrown for documents that open but contain no usable text, or cannot be opened. */
export class DocumentReadError extends Error {
  readonly code: 'PDF_NO_TEXT' | 'PDF_UNREADABLE' | 'DOCUMENT_PARSER_UNAVAILABLE';
  constructor(code: DocumentReadError['code'], message: string) {
    super(message);
    this.name = 'DocumentReadError';
    this.code = code;
  }
}

let canvasLoaded = false;
let createCanvas: any = null;
function loadCanvas(): any {
  if (!canvasLoaded) {
    canvasLoaded = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      createCanvas = require('@napi-rs/canvas').createCanvas;
    } catch {
      console.warn('Canvas module (@napi-rs/canvas) is not available. Scanned-PDF OCR will be skipped.');
    }
  }
  return createCanvas;
}

async function loadPdfjs(): Promise<any> {
  try {
    return await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (err: any) {
    throw new DocumentReadError('DOCUMENT_PARSER_UNAVAILABLE', `pdfjs-dist failed to load: ${err?.message ?? err}`);
  }
}

async function loadTesseract(): Promise<any> {
  try {
    return await import('tesseract.js');
  } catch (err: any) {
    throw new DocumentReadError('DOCUMENT_PARSER_UNAVAILABLE', `tesseract.js failed to load: ${err?.message ?? err}`);
  }
}

// pdfjs wants a URL with a trailing slash, not an OS path — `require.resolve`
// is rewritten by webpack here, so derive it from the working directory and
// fall back to undefined (warning only) if the fonts are not on disk.
const PDFJS_STANDARD_FONTS = (() => {
  try {
    const dir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts');
    if (!fs.existsSync(dir)) return undefined;
    return pathToFileURL(dir).href + '/';
  } catch {
    return undefined;
  }
})();

export class OcrService {
  /**
   * Main entry point to extract raw text from an uploaded file buffer.
   */
  static async extractRawText(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    onStatusChange?: (status: 'OCR_RUNNING' | 'EXTRACTING') => void
  ): Promise<{ text: string; wasOcrUsed: boolean }> {
    const ext = path.extname(fileName).toLowerCase();

    if (mimeType === 'application/pdf' || ext === '.pdf') {
      return this.parsePdf(fileBuffer, onStatusChange);
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      const text = await this.parseDocx(fileBuffer);
      return { text: this.cleanText(text), wasOcrUsed: false };
    } else if (
      mimeType.startsWith('image/') ||
      ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp'].includes(ext)
    ) {
      if (onStatusChange) onStatusChange('OCR_RUNNING');
      const text = await this.performOcr(fileBuffer);
      return { text: this.cleanText(text), wasOcrUsed: true };
    } else {
      throw new Error(`Unsupported file type: ${mimeType} (${fileName})`);
    }
  }

  /**
   * Parse PDF files. Checks for selectable text. If empty, runs OCR on pages.
   */
  private static async parsePdf(
    fileBuffer: Buffer,
    onStatusChange?: (status: 'OCR_RUNNING' | 'EXTRACTING') => void
  ): Promise<{ text: string; wasOcrUsed: boolean }> {
    const pdfjs = await loadPdfjs();
    const uint8Array = new Uint8Array(fileBuffer);
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      // Without this, pdfjs warns "Ensure that the standardFontDataUrl API
      // parameter is provided" and cannot draw Helvetica/Times text when a
      // scanned page is rendered for the Tesseract fallback.
      standardFontDataUrl: PDFJS_STANDARD_FONTS,
    });
    let pdfDoc: any;
    try {
      pdfDoc = await loadingTask.promise;
    } catch (err: any) {
      // InvalidPDFException, PasswordException, FormatError…
      throw new DocumentReadError('PDF_UNREADABLE', `${err?.name ?? 'Error'}: ${err?.message ?? err}`);
    }

    let textContent = '';
    let hasSelectableText = false;

    // 1. Attempt standard text extraction
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const text = await page.getTextContent();
      const pageText = text.items.map((item: any) => item.str).join(' ');
      textContent += pageText + '\n';
    }

    const cleanedText = this.cleanText(textContent);
    // If text has valid characters, skip OCR
    if (cleanedText.trim().length > 100 && /[a-zA-Z0-9]/.test(cleanedText)) {
      return { text: cleanedText, wasOcrUsed: false };
    }

    // 2. Fallback to OCR if selectable text is sparse and canvas is available
    const createCanvas = loadCanvas();
    if (!createCanvas) {
      if (cleanedText.trim()) return { text: cleanedText, wasOcrUsed: false };
      throw new DocumentReadError('PDF_NO_TEXT', 'PDF has no selectable text and OCR (canvas) is not available.');
    }

    if (onStatusChange) onStatusChange('OCR_RUNNING');
    console.log(`PDF contains no selectable text. Executing Tesseract OCR on ${pdfDoc.numPages} pages...`);

    let ocrText = '';
    const { createWorker } = await loadTesseract();
    const worker = await createWorker('eng');
    try {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        
        // Render page to canvas at 1.5x scale
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        // Use a custom object instead of browser DOM canvas
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas as any
        }).promise;

        // Extract image buffer
        const pageImageBuffer = canvas.toBuffer('image/png');
        const { data } = await worker.recognize(pageImageBuffer);
        ocrText += data.text + '\n';
      }
    } finally {
      await worker.terminate();
    }

    return { text: this.cleanText(ocrText), wasOcrUsed: true };
  }

  /**
   * Parse Microsoft DOCX files using mammoth.
   */
  private static async parseDocx(fileBuffer: Buffer): Promise<string> {
    let mammoth: any;
    try {
      mammoth = await import('mammoth');
    } catch (err: any) {
      throw new DocumentReadError('DOCUMENT_PARSER_UNAVAILABLE', `mammoth failed to load: ${err?.message ?? err}`);
    }
    try {
      const result = await (mammoth.extractRawText ?? mammoth.default.extractRawText)({ buffer: fileBuffer });
      return result.value;
    } catch (err: any) {
      throw new DocumentReadError('PDF_UNREADABLE', `DOCX could not be read: ${err?.message ?? err}`);
    }
  }

  /**
   * Performs Tesseract OCR on a single image buffer.
   */
  public static async performOcr(imageBuffer: Buffer): Promise<string> {
    const { createWorker } = await loadTesseract();
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(imageBuffer);
      return data.text;
    } finally {
      await worker.terminate();
    }
  }

  /**
   * Helper to clean up formatting, double spacing, and normalize lines.
   */
  public static cleanText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '') // remove non-printable ASCII/latin characters
      .replace(/[ \t]+$/gm, '') // remove trailing spaces at the end of each line
      .replace(/[ \t]+/g, ' ') // collapse horizontal spaces
      .replace(/\n\s*\n+/g, '\n\n') // collapse multiple blank lines
      .trim();
  }
}
