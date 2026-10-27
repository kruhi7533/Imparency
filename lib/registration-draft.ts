/**
 * NGO registration save-and-resume (NGO-001). Pure helpers.
 *
 * A draft holds whatever the NGO has typed so far plus any documents already
 * uploaded (private storage, same URL form as NGOProfile.documents). It is not
 * a profile: nothing here enters the verification queue. Submitting still goes
 * through POST /api/ngo/register, which falls back to a draft's stored
 * document for any slot the final form does not re-send, then marks the draft
 * SUBMITTED — so the existing extraction pass runs exactly as before.
 */

export const DRAFT_TEXT_FIELDS = [
  "orgName",
  "registrationNumber",
  "panNumber",
  "address",
  "website",
  "foundedYear",
  "description",
  "fcraNumber",
] as const;

export const DRAFT_DOC_SLOTS = ["regFile", "panFile", "taxFile", "a12File", "fcraFile"] as const;
export type DraftDocSlot = (typeof DRAFT_DOC_SLOTS)[number];

export type DraftFields = Partial<Record<(typeof DRAFT_TEXT_FIELDS)[number], string>> & { causeCategories?: string[] };
export type DraftDocuments = Partial<Record<DraftDocSlot, { url: string; name: string }>>;

const MAX_LEN: Record<string, number> = { description: 5000, address: 1000 };

/** Keep only known fields, as trimmed strings; drafts may be incomplete, so nothing is required. */
export function sanitizeDraftFields(input: Record<string, unknown>): DraftFields {
  const out: DraftFields = {};
  for (const k of DRAFT_TEXT_FIELDS) {
    const v = input[k];
    if (typeof v === "string") out[k] = v.trim().slice(0, MAX_LEN[k] ?? 300);
  }
  let causes: unknown = input.causeCategories;
  if (typeof causes === "string") {
    try {
      causes = JSON.parse(causes);
    } catch {
      causes = [];
    }
  }
  if (Array.isArray(causes)) out.causeCategories = causes.filter((c): c is string => typeof c === "string").slice(0, 20).map((c) => c.slice(0, 80));
  return out;
}

export function isDraftDocuments(v: unknown): v is DraftDocuments {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The document URL a final submission should use for a slot when no new file was sent. */
export function draftDocUrl(docs: unknown, slot: DraftDocSlot): string | null {
  if (!isDraftDocuments(docs)) return null;
  const d = docs[slot];
  return d && typeof d.url === "string" && d.url ? d.url : null;
}

export function validateDraftPdf(file: { type: string; size: number }): string | null {
  if (file.type !== "application/pdf") return "must be a PDF document";
  if (file.size > 10 * 1024 * 1024) return "exceeds the 10MB limit";
  return null;
}
