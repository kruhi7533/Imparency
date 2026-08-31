import { GoogleGenAI, Type } from "@google/genai";

/**
 * Requirements Analyst agent — field-level extraction from NGO registration
 * documents.
 *
 * This is the ONLY AI pass over an NGO's registration documents. It produces a
 * value + confidence PER FIELD, tied to the document it came from, so an admin
 * can validate each field independently and NGOCompliance.*Verified flags can
 * be earned by specific evidence instead of set wholesale on approve.
 *
 * It replaced two other passes (a blocking document-verification call and a
 * whole-set screening summary) that read the same PDFs, disagreed about what
 * they were, and produced output no human ever acted on.
 *
 * Core principle (repo convention, ARCHITECTURE §7 "AI proposes, code
 * disposes"): this agent never decides anything. It reports what it read and
 * how sure it is. lib/extraction-runner.ts applies deterministic format checks
 * and the confidence threshold; an admin makes the final call.
 *
 * Hallucination guardrail: every extracted value is `nullable` and omitted
 * from `required`, so "not found" is a representable answer. Contrast
 * lib/gemini/verify-fcra-doc.ts, which types fcra_number as `string | null`
 * but declares it Type.STRING inside `required` — structurally forcing the
 * model to emit a string even when the field is absent.
 */

export type ExtractionDocType =
  | "REGISTRATION_CERTIFICATE"
  | "PAN_CARD"
  | "TAX_EXEMPTION_12A"
  | "TAX_EXEMPTION_80G"
  | "FCRA_CERTIFICATE"
  | "BANK_PROOF"
  | "UNKNOWN";

export const EXTRACTION_DOC_TYPES: ExtractionDocType[] = [
  "REGISTRATION_CERTIFICATE",
  "PAN_CARD",
  "TAX_EXEMPTION_12A",
  "TAX_EXEMPTION_80G",
  "FCRA_CERTIFICATE",
  "BANK_PROOF",
  "UNKNOWN",
];

/** The fields an admin validates, and the document type each is evidence from. */
export const FIELD_SOURCE_DOC: Record<string, ExtractionDocType> = {
  orgName: "REGISTRATION_CERTIFICATE",
  registrationNumber: "REGISTRATION_CERTIFICATE",
  panNumber: "PAN_CARD",
  a12Number: "TAX_EXEMPTION_12A",
  eightyGNumber: "TAX_EXEMPTION_80G",
};

export const EXTRACTION_FIELD_KEYS = Object.keys(FIELD_SOURCE_DOC);

export const FIELD_LABELS: Record<string, string> = {
  orgName: "Organisation name",
  registrationNumber: "Registration number",
  panNumber: "PAN number",
  a12Number: "12A registration number",
  eightyGNumber: "80G registration number",
};

export interface DocumentClassification {
  documentIndex: number;
  docType: ExtractionDocType;
  docTypeConfidence: number; // 0..1
  readable: boolean;
  note: string | null;
  /**
   * The organisation name as printed on THIS document, or null if it carries
   * none. Collected per-document so lib/verification-triage.ts can compare them
   * against each other: the per-field answer reports one winning value, which
   * makes a certificate belonging to a differently-named entity invisible.
   */
  orgNameOnDocument: string | null;
}

export interface ExtractedFieldResult {
  fieldKey: string;
  /** null is a legitimate, expected answer — the field was not found. */
  value: string | null;
  confidence: number; // 0..1
  sourceDocumentIndex: number | null;
  note: string | null;
}

export interface FieldExtractionResult {
  documents: DocumentClassification[];
  fields: ExtractedFieldResult[];
  summary: string;
}

export interface ExtractionDocument {
  buffer: Buffer;
  mimeType: string;
}

export interface ExtractionFormData {
  orgName: string;
  panNumber: string;
  registrationNumber: string;
}

function emptyFields(note: string): ExtractedFieldResult[] {
  return EXTRACTION_FIELD_KEYS.map((fieldKey) => ({
    fieldKey,
    value: null,
    confidence: 0,
    sourceDocumentIndex: null,
    note,
  }));
}

/**
 * Reads the NGO's uploaded documents and reports, per field, what it found and
 * how confident it is. Never throws for content reasons — only for transport
 * failures, which the runner catches and stores as FAILED.
 */
export async function extractNgoFields(
  form: ExtractionFormData,
  documents: ExtractionDocument[]
): Promise<FieldExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Mock fallback (repo convention). Deliberately returns NULL values at zero
  // confidence rather than echoing the form data back: a mock that invents
  // plausible values would let every field pass the threshold and silently
  // auto-validate compliance flags with no evidence behind them.
  if (!apiKey) {
    console.warn(
      "GEMINI_API_KEY is not defined. Falling back to Mock NGO field extraction (all fields land in NEEDS_REVIEW)."
    );
    return {
      documents: documents.map((_, i) => ({
        documentIndex: i,
        docType: "UNKNOWN" as ExtractionDocType,
        docTypeConfidence: 0,
        readable: false,
        note: "Mock extraction — no GEMINI_API_KEY configured.",
        orgNameOnDocument: null,
      })),
      fields: emptyFields("Mock extraction — no value read. Manual entry required."),
      summary:
        "Mock extraction (no GEMINI_API_KEY). No fields were read from the documents; every field requires manual review.",
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a document analyst for an Indian charitable donation platform. An NGO has uploaded supporting documents during registration. The uploads are UNLABELLED — you must classify each one by its content.

WHAT THE NGO TYPED ON THE REGISTRATION FORM (for cross-checking only — do NOT copy these values into your answer):
- Organisation name: "${form.orgName}"
- PAN number: "${form.panNumber}"
- Registration number: "${form.registrationNumber}"

You are given ${documents.length} document(s), each preceded by a "--- DOCUMENT <n> ---" marker.

TASK 1 — classify every document.
For each document return its index, one docType from [REGISTRATION_CERTIFICATE, PAN_CARD, TAX_EXEMPTION_12A, TAX_EXEMPTION_80G, FCRA_CERTIFICATE, BANK_PROOF, UNKNOWN], a docTypeConfidence from 0 to 1, whether it is readable, and a short note if it is unreadable, blank, or ambiguous.

Also return orgNameOnDocument: the organisation's name EXACTLY as printed on THAT document, or null if that document carries no organisation name. Report each document's own name independently — do NOT reconcile them with each other or with the form. If two documents name different entities, that difference is the single most useful thing you can report, and copying one document's name onto another destroys it.

TASK 2 — extract these fields:
- orgName — the organisation's registered name, from the registration certificate
- registrationNumber — the society/trust/company registration number
- panNumber — the 10-character PAN, from the PAN card
- a12Number — the 12A registration/approval number, if a 12A certificate is present
- eightyGNumber — the 80G registration/approval number, if an 80G certificate is present

RULES — these matter more than completeness:
1. Return the value EXACTLY as printed in the document. Do not normalise, correct, or complete it.
2. If a field is not present in any document, return value: null. NEVER guess, and never copy the form value above to fill a gap — a null is a correct and useful answer, an invented value is a serious error.
3. confidence must reflect how clearly YOU READ THE VALUE IN THE DOCUMENT — not how plausible it looks. A crisp scan of the exact field is high confidence; a blurry, cropped, partially-obscured, or inferred value is low confidence. If value is null, confidence must be 0.
4. sourceDocumentIndex must be the index of the document you actually read the value from, or null if value is null.
5. Return exactly one entry per field key listed in TASK 2, even when the value is null.

Finish with a one-sentence plain-text summary for the reviewing admin.

Return ONLY valid JSON matching the response schema. No markdown, no preamble.`;

  const contents: any[] = [prompt];
  documents.forEach((doc, i) => {
    contents.push(`--- DOCUMENT ${i} ---`);
    contents.push({
      inlineData: {
        data: doc.buffer.toString("base64"),
        mimeType: doc.mimeType,
      },
    });
  });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            documents: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  documentIndex: { type: Type.INTEGER },
                  docType: { type: Type.STRING, enum: EXTRACTION_DOC_TYPES },
                  docTypeConfidence: { type: Type.NUMBER },
                  readable: { type: Type.BOOLEAN },
                  note: { type: Type.STRING, nullable: true },
                  // nullable + absent from `required`: a PAN card or bank proof
                  // may carry no organisation name, and "none" must be sayable.
                  orgNameOnDocument: { type: Type.STRING, nullable: true },
                },
                required: ["documentIndex", "docType", "docTypeConfidence", "readable"],
              },
            },
            fields: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  fieldKey: { type: Type.STRING, enum: EXTRACTION_FIELD_KEYS },
                  // nullable + absent from `required`: "not found" must be
                  // representable, or the model is forced to invent a value.
                  value: { type: Type.STRING, nullable: true },
                  confidence: { type: Type.NUMBER },
                  sourceDocumentIndex: { type: Type.INTEGER, nullable: true },
                  note: { type: Type.STRING, nullable: true },
                },
                required: ["fieldKey", "confidence"],
              },
            },
            summary: { type: Type.STRING },
          },
          required: ["documents", "fields", "summary"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini API");
    }

    const parsed = JSON.parse(text);
    return normaliseResult(parsed, documents.length);
  } catch (err: any) {
    console.error("Gemini NGO field extraction API error:", err);
    throw new Error(`Gemini NGO field extraction failed: ${err.message}`);
  }
}

/**
 * Defensive normalisation. A schema-constrained response is still model output:
 * clamp confidences into range, drop unknown field keys, and guarantee one
 * entry per expected field so downstream code never has to handle a gap.
 */
function normaliseResult(parsed: any, documentCount: number): FieldExtractionResult {
  const clamp = (n: any): number => {
    const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
    return Math.min(1, Math.max(0, v));
  };

  const rawDocs: any[] = Array.isArray(parsed?.documents) ? parsed.documents : [];
  const documents: DocumentClassification[] = [];
  for (let i = 0; i < documentCount; i++) {
    const match = rawDocs.find((d) => d?.documentIndex === i);
    documents.push({
      documentIndex: i,
      docType: EXTRACTION_DOC_TYPES.includes(match?.docType) ? match.docType : "UNKNOWN",
      docTypeConfidence: clamp(match?.docTypeConfidence),
      readable: typeof match?.readable === "boolean" ? match.readable : false,
      note: match?.note ? String(match.note) : match ? null : "Document was not classified by the agent.",
      orgNameOnDocument:
        typeof match?.orgNameOnDocument === "string" && match.orgNameOnDocument.trim()
          ? match.orgNameOnDocument.trim()
          : null,
    });
  }

  const rawFields: any[] = Array.isArray(parsed?.fields) ? parsed.fields : [];
  const fields: ExtractedFieldResult[] = EXTRACTION_FIELD_KEYS.map((fieldKey) => {
    const match = rawFields.find((f) => f?.fieldKey === fieldKey);
    const rawValue = match?.value;
    const value =
      typeof rawValue === "string" && rawValue.trim().length > 0 ? rawValue.trim() : null;

    const srcRaw = match?.sourceDocumentIndex;
    const sourceDocumentIndex =
      typeof srcRaw === "number" && srcRaw >= 0 && srcRaw < documentCount ? srcRaw : null;

    return {
      fieldKey,
      value,
      // A null value with a non-zero confidence is incoherent; force it to 0 so
      // it can never clear the threshold.
      confidence: value === null ? 0 : clamp(match?.confidence),
      sourceDocumentIndex: value === null ? null : sourceDocumentIndex,
      note: match?.note ? String(match.note) : null,
    };
  });

  return {
    documents,
    fields,
    summary:
      typeof parsed?.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Extraction complete. Review each field before approving.",
  };
}
