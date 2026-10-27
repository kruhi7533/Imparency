/**
 * Rule-based reading of NGO registration documents — the path taken when no
 * model is configured or the model call fails. Server-only (reads PDF text).
 *
 * Same output contract as extractNgoFields, and the same rules: a value is
 * reported only when it is literally printed in a document, `null` otherwise,
 * and the form the NGO typed is never copied in. Confidence is capped below a
 * crisp model read so that anything the pattern only half-matched lands in
 * NEEDS_REVIEW through resolveField's threshold, and a human still validates
 * every field before it earns a compliance flag.
 */
import { extractPdfText, PdfTextError } from "@/lib/pdf-text";
import {
  EXTRACTION_FIELD_KEYS,
  FIELD_SOURCE_DOC,
  type DocumentClassification,
  type ExtractedFieldResult,
  type ExtractionDocType,
  type ExtractionDocument,
  type FieldExtractionResult,
} from "@/lib/gemini/extract-ngo-fields";

export const RULE_EXTRACTION_NOTE = "Rule-based extraction (no AI model) — confirm against the document.";

/** A value printed after its own label ("PAN: …"): reliable enough to clear the threshold. */
const LABELLED = 0.9;
/** A value found by shape alone, with no label next to it. */
const UNLABELLED = 0.6;

const DOC_TYPE_RULES: Array<{ type: ExtractionDocType; patterns: RegExp[] }> = [
  { type: "FCRA_CERTIFICATE", patterns: [/foreign contribution/i, /\bFCRA\b/] },
  { type: "TAX_EXEMPTION_80G", patterns: [/\b80\s*G\b/i, /section\s*80G/i] },
  { type: "TAX_EXEMPTION_12A", patterns: [/\b12\s*A{1,2}B?\b/i, /section\s*12A/i] },
  { type: "PAN_CARD", patterns: [/permanent account number/i, /income tax department/i, /\bPAN\s*card\b/i] },
  {
    type: "REGISTRATION_CERTIFICATE",
    patterns: [
      /certificate of registration/i,
      /registration certificate/i,
      /registrar of (societies|companies)/i,
      /trust deed/i,
      /societies registration act/i,
      /indian trusts act/i,
      /certificate of incorporation/i,
    ],
  },
  { type: "BANK_PROOF", patterns: [/\bIFSC\b/i, /cancelled cheque/i, /bank statement/i] },
];

export function classifyDocument(text: string): { docType: ExtractionDocType; confidence: number } {
  let best: { docType: ExtractionDocType; hits: number } = { docType: "UNKNOWN", hits: 0 };
  for (const rule of DOC_TYPE_RULES) {
    const hits = rule.patterns.filter((p) => p.test(text)).length;
    if (hits > best.hits) best = { docType: rule.type, hits };
  }
  if (best.hits === 0) return { docType: "UNKNOWN", confidence: 0 };
  return { docType: best.docType, confidence: best.hits > 1 ? 0.9 : 0.7 };
}

const PAN_SHAPE = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
const VALUE = String.raw`[:\-–]?\s*([A-Z0-9][A-Z0-9/\-. ]{2,40}[A-Z0-9])`;

function labelled(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*${VALUE}`, "i");
    const m = text.match(re);
    if (m) return m[1].replace(/\s+/g, " ").trim();
  }
  return null;
}

const ORG_NAME_LABELS = [
  String.raw`name of the (?:trust|society|organi[sz]ation|company|institution|ngo|assessee)`,
  String.raw`(?:trust|society|organi[sz]ation|company) name`,
  String.raw`name of (?:applicant|entity)`,
  String.raw`in the name of`,
];

/** The organisation's name as printed on this document, or null. */
export function findOrgName(text: string): { value: string; confidence: number } | null {
  for (const label of ORG_NAME_LABELS) {
    const m = text.match(new RegExp(`${label}\\s*[:\\-–]?\\s*([^\\n]{3,120})`, "i"));
    if (m) {
      const value = m[1].replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
      if (value.length >= 3) return { value, confidence: LABELLED };
    }
  }
  // Unlabelled: a line that reads like an organisation's name.
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /\b(trust|society|foundation|samiti|sangh|sanstha|association|mission|federation)\b/i.test(l) && l.length <= 100 && !/act\b/i.test(l));
  return line ? { value: line.replace(/[.,;:]+$/, ""), confidence: UNLABELLED } : null;
}

interface FieldRule {
  labels: string[];
  shape?: RegExp;
}

const FIELD_RULES: Record<string, FieldRule> = {
  registrationNumber: {
    labels: [
      String.raw`registration (?:no|number|num)\.?`,
      String.raw`reg(?:d|n)?\.? ?no\.?`,
      String.raw`certificate (?:no|number)\.?`,
      String.raw`\bCIN\b`,
    ],
  },
  panNumber: { labels: [String.raw`\bPAN\b(?: (?:no|number))?\.?`, String.raw`permanent account number`], shape: PAN_SHAPE },
  a12Number: {
    labels: [String.raw`unique registration number`, String.raw`\bURN\b`, String.raw`12A{1,2}B? (?:registration )?(?:no|number)\.?`, String.raw`approval (?:no|number)\.?`],
  },
  eightyGNumber: {
    labels: [String.raw`unique registration number`, String.raw`\bURN\b`, String.raw`80G (?:registration |approval )?(?:no|number)\.?`, String.raw`approval (?:no|number)\.?`],
  },
};

function findField(fieldKey: string, text: string): { value: string; confidence: number } | null {
  if (fieldKey === "orgName") return findOrgName(text);
  const rule = FIELD_RULES[fieldKey];
  if (!rule) return null;
  let value = labelled(text, rule.labels);
  if (value && fieldKey === "panNumber") {
    // A label followed by something that is not a PAN is not a PAN.
    const pan = value.toUpperCase().replace(/\s/g, "").match(PAN_SHAPE);
    value = pan ? pan[1] : null;
  }
  if (value) return { value, confidence: LABELLED };
  if (rule.shape) {
    const m = text.match(rule.shape);
    if (m) return { value: m[1], confidence: UNLABELLED };
  }
  return null;
}

export async function extractNgoFieldsByRules(documents: ExtractionDocument[]): Promise<FieldExtractionResult> {
  const texts: Array<string | null> = [];
  const classified: DocumentClassification[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    let text: string | null = null;
    let note: string | null = null;
    if (doc.mimeType === "application/pdf") {
      try {
        text = (await extractPdfText(doc.buffer)).text;
      } catch (err) {
        note = err instanceof PdfTextError ? err.message : "The document could not be read.";
      }
    } else {
      note = "Rule-based extraction reads text PDFs only; images need manual review.";
    }
    texts.push(text);
    const cls = text ? classifyDocument(text) : { docType: "UNKNOWN" as ExtractionDocType, confidence: 0 };
    classified.push({
      documentIndex: i,
      docType: cls.docType,
      docTypeConfidence: cls.confidence,
      readable: text !== null,
      note,
      orgNameOnDocument: text ? findOrgName(text)?.value ?? null : null,
    });
  }

  const fields: ExtractedFieldResult[] = EXTRACTION_FIELD_KEYS.map((fieldKey) => {
    // Prefer the document type the field is evidence from, then any readable one.
    const order = classified
      .filter((d) => texts[d.documentIndex])
      .sort((a, b) => Number(b.docType === FIELD_SOURCE_DOC[fieldKey]) - Number(a.docType === FIELD_SOURCE_DOC[fieldKey]));
    for (const d of order) {
      // 12A/80G numbers only count when read from that certificate — the same
      // "unique registration number" label appears on both.
      if ((fieldKey === "a12Number" || fieldKey === "eightyGNumber") && d.docType !== FIELD_SOURCE_DOC[fieldKey]) continue;
      const found = findField(fieldKey, texts[d.documentIndex]!);
      if (found) {
        const fromSource = d.docType === FIELD_SOURCE_DOC[fieldKey];
        return {
          fieldKey,
          value: found.value,
          confidence: fromSource ? found.confidence : Math.min(found.confidence, UNLABELLED),
          sourceDocumentIndex: d.documentIndex,
          note: RULE_EXTRACTION_NOTE,
        };
      }
    }
    return { fieldKey, value: null, confidence: 0, sourceDocumentIndex: null, note: "Not found in any document (rule-based extraction)." };
  });

  const readable = classified.filter((d) => d.readable).length;
  const found = fields.filter((f) => f.value !== null).length;
  return {
    documents: classified,
    fields,
    summary: `Rule-based extraction (no AI model configured): read ${readable} of ${documents.length} document(s) and found ${found} of ${fields.length} fields. Confirm each value against the document before approving.`,
  };
}
