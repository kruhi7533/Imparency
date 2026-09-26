import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

// Conditionally load canvas to prevent failure if it is missing in any environments
let createCanvas: any = null;
try {
  const canvasModule = require('@napi-rs/canvas');
  createCanvas = canvasModule.createCanvas;
} catch (e) {
  console.warn('Canvas module (@napi-rs/canvas) is not available. PDF page rendering will be skipped.');
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
    const uint8Array = new Uint8Array(fileBuffer);
    const loadingTask = pdfjs.getDocument({
      data: uint8Array,
      // Without this, pdfjs warns "Ensure that the standardFontDataUrl API
      // parameter is provided" and cannot draw Helvetica/Times text when a
      // scanned page is rendered for the Tesseract fallback.
      standardFontDataUrl: PDFJS_STANDARD_FONTS,
    });
    const pdfDoc = await loadingTask.promise;

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
    if (!createCanvas) {
      console.warn('PDF has no selectable text, and canvas is not loaded. Returning empty text.');
      return { text: '', wasOcrUsed: false };
    }

    if (onStatusChange) onStatusChange('OCR_RUNNING');
    console.log(`PDF contains no selectable text. Executing Tesseract OCR on ${pdfDoc.numPages} pages...`);

    let ocrText = '';
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
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return result.value;
  }

  /**
   * Performs Tesseract OCR on a single image buffer.
   */
  public static async performOcr(imageBuffer: Buffer): Promise<string> {
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
