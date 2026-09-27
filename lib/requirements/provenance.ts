import { RequirementWorkflowError } from "./errors";

/**
 * Field-level provenance for extracted CSR requirements.
 *
 * Every field is stored as { value, confidence, source, aiConfidence? }:
 *   - AI_EXTRACTED    straight from the Requirements Analyst Agent
 *   - DONOR_ENTERED   typed by the donor in the structured form (no document)
 *   - DONOR_CORRECTED the donor changed the value (confidence 1.0)
 *   - ADMIN_VERIFIED  an admin changed or verified the value
 * Only fields whose value actually changed are re-sourced — saving a form never
 * blanket-upgrades untouched AI guesses to 100%. `aiConfidence` keeps the
 * model's original confidence after a human overrides the value.
 */
export type FieldSource = "AI_EXTRACTED" | "DONOR_ENTERED" | "DONOR_CORRECTED" | "ADMIN_VERIFIED";

export interface ProvenancedField<T = unknown> {
  value: T | null;
  confidence: number;
  source: FieldSource;
  aiConfidence?: number;
}

type FieldKind = "string" | "number" | "string[]";

/** `extractedByAgent` marker for requirements typed into the form (no document, no AI). */
export const FORM_ENTRY_AGENT = "DONOR_FORM";

/** The 18 dimensions extracted by the Requirements Analyst Agent. */
export const REQUIREMENT_FIELDS: Record<string, { kind: FieldKind; label: string }> = {
  summary: { kind: "string", label: "Executive summary" },
  sector: { kind: "string", label: "CSR sector / programme" },
  state: { kind: "string", label: "Target state" },
  district: { kind: "string", label: "Target district" },
  budgetMin: { kind: "number", label: "Minimum budget" },
  budgetMax: { kind: "number", label: "Maximum budget" },
  currency: { kind: "string", label: "Currency" },
  durationMonths: { kind: "number", label: "Duration (months)" },
  expectedBeneficiaries: { kind: "number", label: "Expected beneficiaries" },
  primaryKPIs: { kind: "string[]", label: "Primary KPIs" },
  secondaryKPIs: { kind: "string[]", label: "Secondary KPIs" },
  reportingCadence: { kind: "string", label: "Reporting cadence" },
  timeline: { kind: "string", label: "Timeline" },
  requiredDocuments: { kind: "string[]", label: "Required documents" },
  contactPerson: { kind: "string", label: "Contact person" },
  contactEmail: { kind: "string", label: "Contact email" },
  contactPhone: { kind: "string", label: "Contact phone" },
  specialConstraints: { kind: "string", label: "Special constraints" },
};

export type RequirementFieldKey = keyof typeof REQUIREMENT_FIELDS;
export const REQUIREMENT_FIELD_KEYS = Object.keys(REQUIREMENT_FIELDS) as RequirementFieldKey[];
export type RequirementFields = Record<RequirementFieldKey, ProvenancedField>;

/** Fields below this confidence are highlighted for human verification. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

const SOURCES: FieldSource[] = ["AI_EXTRACTED", "DONOR_ENTERED", "DONOR_CORRECTED", "ADMIN_VERIFIED"];

/**
 * Normalizes stored JSON (including legacy rows written before provenance
 * existed, which have no `source`) into a complete field map.
 */
export function normalizeFields(raw: unknown): RequirementFields {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const out = {} as RequirementFields;
  for (const key of REQUIREMENT_FIELD_KEYS) {
    const f = input[key];
    const confidence = typeof f?.confidence === "number" ? Math.min(1, Math.max(0, f.confidence)) : 0;
    out[key] = {
      value: f?.value ?? null,
      confidence,
      source: SOURCES.includes(f?.source) ? f.source : "AI_EXTRACTED",
      ...(typeof f?.aiConfidence === "number" ? { aiConfidence: f.aiConfidence } : {}),
    };
  }
  return out;
}

/** Tags freshly extracted LLM output as AI_EXTRACTED. */
export function withAiProvenance(extracted: Record<string, { value: unknown; confidence: number }>): RequirementFields {
  const out = {} as RequirementFields;
  for (const key of REQUIREMENT_FIELD_KEYS) {
    const f = extracted[key];
    out[key] = {
      value: (f?.value as any) ?? null,
      confidence: typeof f?.confidence === "number" ? f.confidence : 0,
      source: "AI_EXTRACTED",
    };
  }
  return out;
}

/**
 * Builds the field map for a requirement the donor typed into the structured
 * form. Every value is validated like an edit; a filled field is certain (1.0),
 * an empty one stays null with confidence 0.
 */
export function withDonorProvenance(values: Record<string, unknown>): RequirementFields {
  for (const key of Object.keys(values)) {
    if (!REQUIREMENT_FIELDS[key]) throw new RequirementWorkflowError(`Unknown requirement field: ${key}`, 400);
  }
  const out = {} as RequirementFields;
  for (const key of REQUIREMENT_FIELD_KEYS) {
    const value = coerceFieldValue(key, values[key] ?? null);
    out[key] = { value: value as any, confidence: value === null ? 0 : 1, source: "DONOR_ENTERED" };
  }
  return out;
}

/** Validates and normalizes one client-supplied value. Empty → null. */
export function coerceFieldValue(key: string, value: unknown): unknown {
  const spec = REQUIREMENT_FIELDS[key];
  if (!spec) throw new RequirementWorkflowError(`Unknown requirement field: ${key}`, 400);
  if (value === null || value === undefined) return null;

  if (spec.kind === "string") {
    if (typeof value !== "string") throw new RequirementWorkflowError(`${spec.label} must be text.`, 400);
    const trimmed = value.trim();
    if (trimmed.length > 5000) throw new RequirementWorkflowError(`${spec.label} is too long.`, 400);
    return trimmed === "" ? null : trimmed;
  }
  if (spec.kind === "number") {
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (n === "" ) return null;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      throw new RequirementWorkflowError(`${spec.label} must be a non-negative number.`, 400);
    }
    return n;
  }
  // string[]
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new RequirementWorkflowError(`${spec.label} must be a list of text values.`, 400);
  }
  const items = (value as string[]).map((v) => v.trim()).filter(Boolean);
  return items.length === 0 ? null : items;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Applies human edits (a map of field → new value; confidence/source from the
 * client are ignored). Returns the new field map plus the keys that changed.
 */
export function applyEdits(
  current: RequirementFields,
  edits: Record<string, unknown>,
  editor: "DONOR" | "ADMIN"
): { fields: RequirementFields; changedKeys: RequirementFieldKey[] } {
  const fields = { ...current };
  const changedKeys: RequirementFieldKey[] = [];

  for (const [key, rawValue] of Object.entries(edits)) {
    const value = coerceFieldValue(key, rawValue);
    const k = key as RequirementFieldKey;
    const prev = current[k];
    if (sameValue(prev.value, value)) continue;

    fields[k] = {
      value: value as any,
      confidence: 1,
      // A donor revising their own form entry is still an entry, not a correction of the AI.
      source: editor === "ADMIN" ? "ADMIN_VERIFIED" : prev.source === "DONOR_ENTERED" ? "DONOR_ENTERED" : "DONOR_CORRECTED",
      aiConfidence: prev.aiConfidence ?? (prev.source === "AI_EXTRACTED" ? prev.confidence : undefined),
    };
    if (fields[k].aiConfidence === undefined) delete fields[k].aiConfidence;
    changedKeys.push(k);
  }

  return { fields, changedKeys };
}

/**
 * Admin approval: every field is now admin-verified. Values are unchanged; a
 * verified non-null value is certain (1.0). A null stays null with its original
 * confidence — the admin confirmed it is absent, not that it is known.
 * The pre-approval sources remain in the revision snapshot taken before this.
 */
export function verifyAll(current: RequirementFields): RequirementFields {
  const out = {} as RequirementFields;
  for (const key of REQUIREMENT_FIELD_KEYS) {
    const f = current[key];
    out[key] = {
      ...f,
      source: "ADMIN_VERIFIED",
      confidence: f.value === null ? f.confidence : 1,
      ...(f.source === "AI_EXTRACTED" && f.aiConfidence === undefined ? { aiConfidence: f.confidence } : {}),
    };
  }
  return out;
}

export function confidenceMap(fields: RequirementFields): Record<string, number> {
  return Object.fromEntries(REQUIREMENT_FIELD_KEYS.map((k) => [k, fields[k].confidence]));
}

/** Mean confidence over fields that have a value (0 when none do). */
export function averageConfidence(fields: RequirementFields): number {
  const withValue = REQUIREMENT_FIELD_KEYS.filter((k) => fields[k].value !== null);
  if (withValue.length === 0) return 0;
  return withValue.reduce((s, k) => s + fields[k].confidence, 0) / withValue.length;
}

export function lowConfidenceKeys(fields: RequirementFields): RequirementFieldKey[] {
  return REQUIREMENT_FIELD_KEYS.filter(
    (k) => fields[k].value !== null && fields[k].confidence < LOW_CONFIDENCE_THRESHOLD
  );
}
