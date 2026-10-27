import { RequirementWorkflowError } from "./errors";

/**
 * Structured reasons a CSR document could not be extracted. Every failure of
 * the upload → parse → model pipeline maps to exactly one of these, is stored on
 * the requirement (`extractionError`) so it survives a reload, and is returned
 * to the client as `{ error, code, retryable, requirementId }` — never as an
 * empty 500. Pure module (no Node imports): the UI imports the labels.
 */
export type ExtractionErrorCode =
  /** No model is configured (no GEMINI_API_KEY). Retry once configured, or enter the fields manually. */
  | "EXTRACTION_PROVIDER_UNAVAILABLE"
  /** The model provider is out of capacity (503/429 across the model chain). */
  | "EXTRACTION_PROVIDER_OVERLOADED"
  /** The model answered with something that does not match the schema. */
  | "EXTRACTION_INVALID_OUTPUT"
  /** The PDF/DOCX/image has no readable text (scanned with no OCR available, blank). */
  | "PDF_NO_TEXT"
  /** The file is malformed or encrypted and the parser cannot open it. */
  | "PDF_UNREADABLE"
  /** The document parser could not be loaded in this runtime (deployment problem). */
  | "DOCUMENT_PARSER_UNAVAILABLE"
  /** Private storage could not store or read the file. */
  | "PRIVATE_STORAGE_UNAVAILABLE"
  /** Anything else — logged server-side, never echoed. */
  | "EXTRACTION_FAILED";

export const EXTRACTION_ERROR_LABELS: Record<ExtractionErrorCode, string> = {
  EXTRACTION_PROVIDER_UNAVAILABLE: "AI extraction is not configured",
  EXTRACTION_PROVIDER_OVERLOADED: "AI service temporarily overloaded",
  EXTRACTION_INVALID_OUTPUT: "AI returned an unusable answer",
  PDF_NO_TEXT: "No readable text in the document",
  PDF_UNREADABLE: "The document could not be opened",
  DOCUMENT_PARSER_UNAVAILABLE: "Document reader unavailable",
  PRIVATE_STORAGE_UNAVAILABLE: "Document storage unavailable",
  EXTRACTION_FAILED: "Document processing failed",
};

const DEFAULTS: Record<ExtractionErrorCode, { status: number; retryable: boolean; message: string }> = {
  EXTRACTION_PROVIDER_UNAVAILABLE: {
    status: 503,
    retryable: true,
    message:
      "AI extraction is not available on this server (no model provider is configured), so no fields were extracted. " +
      "Your document is stored safely: retry extraction later, or enter the requirement details manually.",
  },
  EXTRACTION_PROVIDER_OVERLOADED: {
    status: 503,
    retryable: true,
    message: "The AI service is temporarily overloaded, so your document could not be analysed right now. Retry in a minute or two.",
  },
  EXTRACTION_INVALID_OUTPUT: {
    status: 502,
    retryable: true,
    message: "The AI service returned an answer that did not match the expected structure, so nothing was saved. Retry extraction or enter the details manually.",
  },
  PDF_NO_TEXT: {
    status: 422,
    retryable: false,
    message:
      "No readable text was found in this document (it may be a scan or blank). Upload a text-based PDF or DOCX, or enter the details manually.",
  },
  PDF_UNREADABLE: {
    status: 422,
    retryable: false,
    message: "This file could not be opened — it may be damaged or password-protected. Upload another copy, or enter the details manually.",
  },
  DOCUMENT_PARSER_UNAVAILABLE: {
    status: 503,
    retryable: true,
    message: "The document reader could not start on the server. Your file is stored; retry extraction later or enter the details manually.",
  },
  PRIVATE_STORAGE_UNAVAILABLE: {
    status: 503,
    retryable: true,
    message: "Document storage is unavailable right now, so the file was not saved. Please try again shortly.",
  },
  EXTRACTION_FAILED: {
    status: 500,
    retryable: true,
    message: "Document processing failed. You can retry extraction or enter the details manually.",
  },
};

export class ExtractionError extends RequirementWorkflowError {
  readonly code: ExtractionErrorCode;
  readonly retryable: boolean;
  /** Server-side detail for logs/audit only — never sent to the client. */
  readonly detail: string;
  constructor(code: ExtractionErrorCode, detail = "", message?: string) {
    const d = DEFAULTS[code];
    super(message ?? d.message, d.status, code);
    this.name = "ExtractionError";
    this.code = code;
    this.retryable = d.retryable;
    this.detail = detail;
  }
}

export interface StoredExtractionError {
  code: ExtractionErrorCode;
  message: string;
  retryable: boolean;
  at: string;
}

export function toStoredError(err: ExtractionError, at = new Date()): StoredExtractionError {
  return { code: err.code, message: err.message, retryable: err.retryable, at: at.toISOString() };
}

export function readStoredError(raw: unknown): StoredExtractionError | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== "string" || !(r.code in DEFAULTS)) return null;
  return {
    code: r.code as ExtractionErrorCode,
    message: typeof r.message === "string" ? r.message : DEFAULTS[r.code as ExtractionErrorCode].message,
    retryable: r.retryable === true,
    at: typeof r.at === "string" ? r.at : "",
  };
}

/**
 * Maps anything thrown by the parser/model into one ExtractionError. Matching is
 * by error name/shape (not instanceof) so it works across dynamic imports.
 */
export function classifyExtractionFailure(err: unknown): ExtractionError {
  if (err instanceof ExtractionError) return err;
  const e = err as any;
  const name = String(e?.name ?? "");
  const message = String(e?.message ?? e ?? "");
  if (name === "DocumentReadError" && typeof e?.code === "string" && e.code in DEFAULTS) {
    return new ExtractionError(e.code as ExtractionErrorCode, message);
  }
  if (name === "PdfTextError" && typeof e?.code === "string") {
    if (e.code === "PDF_NO_TEXT") return new ExtractionError("PDF_NO_TEXT", message);
    if (e.code === "PDF_TOO_LARGE") {
      return new ExtractionError("PDF_UNREADABLE", message, `${message} Split the document or enter the details manually.`);
    }
    return new ExtractionError("PDF_UNREADABLE", message);
  }
  if (name === "LlmUnavailableError") return new ExtractionError("EXTRACTION_PROVIDER_OVERLOADED", e?.detail ?? message);
  if (name === "LlmNotConfiguredError" || /GEMINI_API_KEY is not configured/i.test(message)) {
    return new ExtractionError("EXTRACTION_PROVIDER_UNAVAILABLE", message);
  }
  if (name === "ZodError" || name === "SyntaxError" || /empty response/i.test(message)) {
    return new ExtractionError("EXTRACTION_INVALID_OUTPUT", message);
  }
  if (/InvalidPDF|PasswordException|Invalid PDF|FormatError|bad XRef|end of file|Missing PDF/i.test(name + " " + message)) {
    return new ExtractionError("PDF_UNREADABLE", message);
  }
  if (/DOMMatrix|Cannot find module|fake worker|ERR_MODULE_NOT_FOUND|is not defined/i.test(message)) {
    return new ExtractionError("DOCUMENT_PARSER_UNAVAILABLE", message);
  }
  return new ExtractionError("EXTRACTION_FAILED", message);
}
