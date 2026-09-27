"use client";

import {
  REQUIREMENT_FIELDS,
  REQUIREMENT_FIELD_KEYS,
  LOW_CONFIDENCE_THRESHOLD,
  type RequirementFields,
  type RequirementFieldKey,
  type ProvenancedField,
} from "@/lib/requirements/provenance";

/**
 * Shows every extracted field with its value, confidence and provenance
 * (AI extracted / donor corrected / admin verified). In edit mode the parent
 * owns a string "draft"; draftEdits() turns it into the value-only payload the
 * API expects. Confidence and source are never sent — the server sets them.
 */

export type FieldDraft = Record<string, string>;

export function fieldToDraft(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function initialDraft(fields: RequirementFields): FieldDraft {
  return Object.fromEntries(REQUIREMENT_FIELD_KEYS.map((k) => [k, fieldToDraft(fields[k].value)]));
}

/** Only the fields the user changed, converted to API value types. */
export function draftEdits(fields: RequirementFields, draft: FieldDraft): Record<string, unknown> {
  const edits: Record<string, unknown> = {};
  for (const key of REQUIREMENT_FIELD_KEYS) {
    const raw = draft[key] ?? "";
    if (raw === fieldToDraft(fields[key].value)) continue;
    const kind = REQUIREMENT_FIELDS[key].kind;
    if (raw.trim() === "") edits[key] = null;
    else if (kind === "number") edits[key] = Number(raw.replace(/,/g, ""));
    else if (kind === "string[]") edits[key] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    else edits[key] = raw;
  }
  return edits;
}

const SOURCE_LABEL: Record<string, string> = {
  AI_EXTRACTED: "AI",
  DONOR_ENTERED: "Donor entered",
  DONOR_CORRECTED: "Donor corrected",
  ADMIN_VERIFIED: "Admin verified",
};

function isLow(f: ProvenancedField) {
  return f.value !== null && f.source === "AI_EXTRACTED" && f.confidence < LOW_CONFIDENCE_THRESHOLD;
}

function ProvenanceChip({ field }: { field: ProvenancedField }) {
  const pct = Math.round(field.confidence * 100);
  const tone =
    field.source === "ADMIN_VERIFIED"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
      : field.source === "DONOR_CORRECTED" || field.source === "DONOR_ENTERED"
      ? "bg-blue-500/10 text-blue-300 border-blue-500/25"
      : isLow(field)
      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
      : "bg-gray-800 text-gray-300 border-gray-700";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${tone}`}>
      {SOURCE_LABEL[field.source] ?? field.source}
      {field.value !== null && <span className="opacity-80">· {pct}%</span>}
      {field.aiConfidence !== undefined && field.source !== "AI_EXTRACTED" && (
        <span className="opacity-60 font-medium">(AI was {Math.round(field.aiConfidence * 100)}%)</span>
      )}
    </span>
  );
}

const DISPLAY_ORDER: RequirementFieldKey[] = [
  "summary",
  "sector",
  "state",
  "district",
  "budgetMin",
  "budgetMax",
  "currency",
  "durationMonths",
  "expectedBeneficiaries",
  "reportingCadence",
  "timeline",
  "specialConstraints",
  "contactPerson",
  "contactEmail",
  "contactPhone",
  "primaryKPIs",
  "secondaryKPIs",
  "requiredDocuments",
];

const WIDE = new Set<RequirementFieldKey>(["summary", "specialConstraints", "primaryKPIs", "secondaryKPIs", "requiredDocuments"]);

function formatValue(key: RequirementFieldKey, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number" && (key === "budgetMin" || key === "budgetMax")) return `₹${value.toLocaleString("en-IN")}`;
  if (typeof value === "number") return value.toLocaleString("en-IN");
  return String(value);
}

export function FieldsEditor({
  fields,
  editable,
  draft,
  onChange,
}: {
  fields: RequirementFields;
  editable: boolean;
  draft?: FieldDraft;
  onChange?: (key: RequirementFieldKey, value: string) => void;
}) {
  const lowCount = DISPLAY_ORDER.filter((k) => isLow(fields[k])).length;

  return (
    <div className="space-y-4">
      {lowCount > 0 && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
          ⚠ {lowCount} field{lowCount > 1 ? "s were" : " was"} extracted with confidence below{" "}
          {Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}% — please verify {lowCount > 1 ? "them" : "it"}.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DISPLAY_ORDER.map((key) => {
          const spec = REQUIREMENT_FIELDS[key];
          const field = fields[key];
          const low = isLow(field);
          const changed = editable && draft && draft[key] !== fieldToDraft(field.value);
          return (
            <div
              key={key}
              className={`p-3.5 rounded-xl border bg-gray-950/40 ${WIDE.has(key) ? "md:col-span-2" : ""} ${
                low ? "border-amber-600/40" : changed ? "border-blue-500/40" : "border-gray-800"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <label htmlFor={`field-${key}`} className="text-xs font-semibold text-gray-300">
                  {spec.label}
                  {spec.kind === "string[]" && editable && <span className="text-gray-500 font-normal"> (comma separated)</span>}
                </label>
                <div className="flex items-center gap-1.5">
                  {changed && <span className="text-[10px] font-bold text-blue-300">edited</span>}
                  <ProvenanceChip field={field} />
                </div>
              </div>
              {editable && draft && onChange ? (
                key === "summary" || key === "specialConstraints" ? (
                  <textarea
                    id={`field-${key}`}
                    rows={3}
                    value={draft[key] ?? ""}
                    onChange={(e) => onChange(key, e.target.value)}
                    className="w-full bg-gray-900/70 border border-gray-800 text-sm rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-emerald-500"
                  />
                ) : (
                  <input
                    id={`field-${key}`}
                    type="text"
                    inputMode={spec.kind === "number" ? "decimal" : undefined}
                    value={draft[key] ?? ""}
                    placeholder="Not specified"
                    onChange={(e) => onChange(key, e.target.value)}
                    className="w-full bg-gray-900/70 border border-gray-800 text-sm rounded-lg px-3 py-2 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500"
                  />
                )
              ) : (
                <p className={`text-sm ${field.value === null ? "text-gray-600" : "text-gray-100"} whitespace-pre-wrap break-words`}>
                  {formatValue(key, field.value)}
                </p>
              )}
              {low && <p className="text-[11px] text-amber-400 mt-1.5">⚠ Please verify</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { formatValue };
