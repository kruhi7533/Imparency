import { GoogleGenAI, Type } from "@google/genai";

/**
 * Pre-screening agent for submitted NGOs.
 *
 * Core principle: this agent ONLY surfaces an organized, honest summary so the
 * admin can decide faster. It never approves, rejects, or changes NGO status.
 * Deterministic format checks run in code (not the LLM); the LLM reads the
 * documents and produces a content-based summary.
 */

export type Recommendation = "LOOKS_CLEAR" | "NEEDS_REVIEW" | "LOOKS_PROBLEMATIC";

export interface ScreeningDocument {
  buffer: Buffer;
  mimeType: string;
  // Best-effort label only. The schema has no per-document type, so this is
  // usually undefined and the LLM classifies each document by its content.
  label?: string;
}

export interface DocumentChecklistEntry {
  present: boolean;
  readable: boolean;
  note: string;
}

export interface ScreeningResult {
  summary: string;
  extractedFields: {
    name: string | null;
    pan: string | null;
    registrationNo: string | null;
    bankAccount?: string | null;
    [key: string]: any;
  };
  documentChecklist: {
    registrationCertificate: DocumentChecklistEntry;
    panCard: DocumentChecklistEntry;
    taxExemption80G: DocumentChecklistEntry;
    [key: string]: DocumentChecklistEntry;
  };
  consistencyOk: boolean;
  flags: { severity: "LOW" | "MEDIUM" | "HIGH"; issue: string }[];
  recommendation: Recommendation;
  confidence: number;
}

export interface NgoFormData {
  name: string;
  pan: string;
  registrationNo: string;
  bankAccount?: string;
  ifsc?: string;
}

// ─── Deterministic format checks (code, not LLM) ─────────────────────────────
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const REG_NO_REGEX = /^[A-Za-z0-9\/\-]{5,}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

interface FormatChecks {
  panOk: boolean;
  regNoOk: boolean;
  ifscOk: boolean | null; // null when no bank/IFSC data was provided
  anyFailed: boolean;
}

function runFormatChecks(ngo: NgoFormData): FormatChecks {
  const panOk = PAN_REGEX.test((ngo.pan || "").trim().toUpperCase());
  const regNoOk = REG_NO_REGEX.test((ngo.registrationNo || "").trim());
  // IFSC only checked if bank fields actually exist on the submission.
  const ifscOk = ngo.ifsc ? IFSC_REGEX.test(ngo.ifsc.trim().toUpperCase()) : null;

  const anyFailed = !panOk || !regNoOk || ifscOk === false;
  return { panOk, regNoOk, ifscOk, anyFailed };
}

function emptyChecklistEntry(note: string): DocumentChecklistEntry {
  return { present: false, readable: false, note };
}

/**
 * Honest-limit enforcement: a failing format check OR any missing/unreadable
 * required document must NOT yield LOOKS_CLEAR. We downgrade to at least
 * NEEDS_REVIEW (or keep LOOKS_PROBLEMATIC if already worse).
 */
function enforceHonestLimit(
  result: ScreeningResult,
  formatChecks: FormatChecks
): ScreeningResult {
  const checklist = result.documentChecklist || {};
  const requiredKeys = ["registrationCertificate", "panCard", "taxExemption80G"];
  const anyRequiredMissingOrUnreadable = requiredKeys.some((k) => {
    const entry = checklist[k];
    return !entry || !entry.present || !entry.readable;
  });

  if (
    result.recommendation === "LOOKS_CLEAR" &&
    (formatChecks.anyFailed || anyRequiredMissingOrUnreadable)
  ) {
    return { ...result, recommendation: "NEEDS_REVIEW" };
  }
  return result;
}

// ─── Mock fallback (no GEMINI_API_KEY) ───────────────────────────────────────
function buildMockResult(
  ngo: NgoFormData,
  documents: ScreeningDocument[],
  formatChecks: FormatChecks
): ScreeningResult {
  const flags: ScreeningResult["flags"] = [];
  if (!formatChecks.panOk) flags.push({ severity: "MEDIUM", issue: "PAN format is invalid." });
  if (!formatChecks.regNoOk) flags.push({ severity: "MEDIUM", issue: "Registration number format looks invalid." });
  if (formatChecks.ifscOk === false) flags.push({ severity: "MEDIUM", issue: "IFSC format is invalid." });
  flags.push({ severity: "LOW", issue: "AI document analysis was unavailable (no GEMINI_API_KEY). Format-only screening." });

  // Without the LLM we cannot read or classify documents, only confirm count.
  const mk = (i: number): DocumentChecklistEntry => ({
    present: documents.length > i,
    readable: false,
    note: "Not analysed — AI unavailable.",
  });

  return {
    summary:
      "AI analysis was unavailable, so this is a format-only pre-screening based on mechanical checks of the submitted fields. Document contents were not read. Full manual review required.",
    extractedFields: {
      name: ngo.name || null,
      pan: ngo.pan || null,
      registrationNo: ngo.registrationNo || null,
      bankAccount: ngo.bankAccount || null,
    },
    documentChecklist: {
      registrationCertificate: mk(0),
      panCard: mk(1),
      taxExemption80G: mk(2),
    },
    consistencyOk: false,
    flags,
    recommendation: "NEEDS_REVIEW",
    confidence: 0.2,
  };
}

/**
 * Screens an NGO submission. Returns an organized, honest summary record.
 * Never approves/rejects — it only describes what it sees.
 */
export async function screenNgo(
  ngo: NgoFormData,
  documents: ScreeningDocument[]
): Promise<ScreeningResult> {
  const formatChecks = runFormatChecks(ngo);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn("GEMINI_API_KEY not defined. NGO screening running in format-only mock mode.");
    return buildMockResult(ngo, documents, formatChecks);
  }

  const ai = new GoogleGenAI({ apiKey });

  const formatContext = `
DETERMINISTIC FORMAT CHECKS (already computed in code — treat as ground truth):
- PAN format valid: ${formatChecks.panOk}
- Registration number format plausible: ${formatChecks.regNoOk}
- IFSC format valid: ${formatChecks.ifscOk === null ? "N/A (no bank details submitted)" : formatChecks.ifscOk}
`;

  const prompt = `You are a pre-screening assistant for the admin team of an Indian charitable-donation platform.
Your ONLY job is to read the submitted NGO documents and produce an organized, HONEST summary so a human admin can decide faster.
You do NOT approve or reject anyone. You only describe what you observe.

SUBMITTED NGO DETAILS (as typed by the applicant):
- Organisation name: ${ngo.name}
- PAN: ${ngo.pan}
- Registration number: ${ngo.registrationNo}
${ngo.bankAccount ? `- Bank account: ${ngo.bankAccount}` : ""}

${formatContext}

The applicant uploaded ${documents.length} document(s), attached in order. There is NO reliable per-document type label,
so you MUST classify each document by reading its actual content. Do NOT assume document #1 is the registration
certificate, etc. The platform expects three document types:
  1) registrationCertificate — NGO/society/trust registration certificate
  2) panCard — the organisation's PAN card
  3) taxExemption80G — 80G tax-exemption certificate

For each EXPECTED type, report whether a matching document is present among the uploads and whether it is readable.
If you cannot confidently classify an uploaded document, do NOT mislabel it — instead add a flag noting an
unclassifiable/unexpected document.

Then:
- Extract { name, pan, registrationNo, bankAccount } from the documents (null if not found).
- Assess name consistency across the documents AND against the typed details above (consistencyOk).
- Raise flags for: blurry/unreadable scans, wrong/unexpected document type, name mismatch, missing required fields.
- Write ONE concise one-line summary.
- Give a recommendation: LOOKS_CLEAR | NEEDS_REVIEW | LOOKS_PROBLEMATIC.
- Give a confidence between 0 and 1.

IMPORTANT HONESTY RULES:
- This is mechanical screening of scans only. You CANNOT confirm documents are genuine. Never imply verification.
- Do NOT output LOOKS_CLEAR if any format check above is false, or if any required document is missing/unreadable.

Return ONLY valid JSON matching the schema. No markdown, no preamble.`;

  const inlineFiles = documents.map((d) => ({
    inlineData: {
      data: d.buffer.toString("base64"),
      mimeType: d.mimeType,
    },
  }));

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [prompt, ...inlineFiles],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            extractedFields: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                pan: { type: Type.STRING },
                registrationNo: { type: Type.STRING },
                bankAccount: { type: Type.STRING },
              },
            },
            documentChecklist: {
              type: Type.OBJECT,
              properties: {
                registrationCertificate: {
                  type: Type.OBJECT,
                  properties: {
                    present: { type: Type.BOOLEAN },
                    readable: { type: Type.BOOLEAN },
                    note: { type: Type.STRING },
                  },
                  required: ["present", "readable"],
                },
                panCard: {
                  type: Type.OBJECT,
                  properties: {
                    present: { type: Type.BOOLEAN },
                    readable: { type: Type.BOOLEAN },
                    note: { type: Type.STRING },
                  },
                  required: ["present", "readable"],
                },
                taxExemption80G: {
                  type: Type.OBJECT,
                  properties: {
                    present: { type: Type.BOOLEAN },
                    readable: { type: Type.BOOLEAN },
                    note: { type: Type.STRING },
                  },
                  required: ["present", "readable"],
                },
              },
              required: ["registrationCertificate", "panCard", "taxExemption80G"],
            },
            consistencyOk: { type: Type.BOOLEAN },
            flags: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  severity: { type: Type.STRING },
                  issue: { type: Type.STRING },
                },
                required: ["severity", "issue"],
              },
            },
            recommendation: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
          },
          required: [
            "summary",
            "extractedFields",
            "documentChecklist",
            "consistencyOk",
            "flags",
            "recommendation",
            "confidence",
          ],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response received from Gemini API");

    const raw = JSON.parse(text);

    const normalizeEntry = (e: any, fallbackNote: string): DocumentChecklistEntry => ({
      present: !!e?.present,
      readable: !!e?.readable,
      note: typeof e?.note === "string" ? e.note : fallbackNote,
    });

    const validRecs: Recommendation[] = ["LOOKS_CLEAR", "NEEDS_REVIEW", "LOOKS_PROBLEMATIC"];
    const recommendation: Recommendation = validRecs.includes(raw.recommendation)
      ? raw.recommendation
      : "NEEDS_REVIEW";

    let confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
    if (confidence < 0) confidence = 0;
    if (confidence > 1) confidence = 1;

    const checklist = raw.documentChecklist || {};
    const result: ScreeningResult = {
      summary: typeof raw.summary === "string" ? raw.summary : "",
      extractedFields: {
        name: raw.extractedFields?.name ?? null,
        pan: raw.extractedFields?.pan ?? null,
        registrationNo: raw.extractedFields?.registrationNo ?? null,
        bankAccount: raw.extractedFields?.bankAccount ?? null,
      },
      documentChecklist: {
        registrationCertificate: normalizeEntry(
          checklist.registrationCertificate,
          "Not reported."
        ),
        panCard: normalizeEntry(checklist.panCard, "Not reported."),
        taxExemption80G: normalizeEntry(checklist.taxExemption80G, "Not reported."),
      },
      consistencyOk: !!raw.consistencyOk,
      flags: Array.isArray(raw.flags)
        ? raw.flags.map((f: any) => ({
            severity: ["LOW", "MEDIUM", "HIGH"].includes(f?.severity) ? f.severity : "LOW",
            issue: typeof f?.issue === "string" ? f.issue : String(f),
          }))
        : [],
      recommendation,
      confidence,
    };

    // Surface deterministic format failures as explicit flags too.
    if (!formatChecks.panOk) result.flags.push({ severity: "MEDIUM", issue: "PAN format check failed." });
    if (!formatChecks.regNoOk) result.flags.push({ severity: "MEDIUM", issue: "Registration number format check failed." });
    if (formatChecks.ifscOk === false) result.flags.push({ severity: "MEDIUM", issue: "IFSC format check failed." });

    return enforceHonestLimit(result, formatChecks);
  } catch (err: any) {
    console.error("Gemini NGO screening API error:", err);
    // Surface the failure honestly rather than throwing — runner stores FAILED.
    throw new Error(`NGO screening failed: ${err.message}`);
  }
}
