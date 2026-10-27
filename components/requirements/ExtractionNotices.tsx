"use client";

import { useState } from "react";
import type { RequirementDTO } from "@/lib/requirements/dto";
import { FLAG_LABELS, type ExtractionFlag } from "@/lib/requirements/extraction-checks";
import { EXTRACTION_ERROR_LABELS } from "@/lib/requirements/extraction-errors";

/**
 * What the extraction pipeline wants a human to know about a requirement:
 *   - how the fields were produced (rule-based extraction must be confirmed),
 *   - deterministic warnings (budget conflict, suspected prompt injection) with
 *     a confirm-with-note action while the viewer may act on them,
 *   - why extraction failed (structured code + message).
 */
export function ExtractionMethodBanner({ requirement }: { requirement: RequirementDTO }) {
  if (requirement.extractionMethod !== "RULES") return null;
  return (
    <div className="text-sm text-sky-700 bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
      <p className="font-bold">Rule-based extraction — please confirm</p>
      <p className="text-xs text-sky-700 mt-1">
        No AI model was used. These fields were read from the document by fixed text rules (labels such as “Budget:”,
        “State:”, amounts in ₹/lakh/crore). Anything the rules could not find is left empty for you to fill in — nothing
        was guessed. Check every value against the document before submitting.
      </p>
    </div>
  );
}

export function ExtractionFlagsPanel({
  flags,
  canConfirm,
  onConfirm,
  busy,
}: {
  flags: ExtractionFlag[];
  canConfirm: boolean;
  onConfirm: (flagId: string, note: string) => Promise<boolean>;
  busy: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (flags.length === 0) return null;
  return (
    <div className="space-y-3">
      {flags.map((f) => {
        const confirmed = !!f.confirmedAt;
        return (
          <div
            key={f.id}
            className={`rounded-xl border px-4 py-3 text-sm ${
              confirmed ? "border-gray-300 bg-gray-50 text-gray-700" : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {confirmed ? "✓ " : "⚠ "}
                {FLAG_LABELS[f.code] ?? f.code}
                {!confirmed && f.blocking && <span className="ml-2 text-[10px] uppercase tracking-wide">needs confirmation</span>}
              </p>
              {canConfirm && !confirmed && open !== f.id && (
                <button type="button" onClick={() => { setOpen(f.id); setNote(""); }} className="text-xs font-bold underline">
                  Confirm…
                </button>
              )}
            </div>
            <p className="text-xs mt-1 opacity-90">{f.message}</p>
            {f.evidence.length > 0 && (
              <ul className="mt-2 space-y-1">
                {f.evidence.map((e, i) => (
                  <li key={i} className="text-xs font-mono bg-white/70 rounded px-2 py-1 break-words">“{e}”</li>
                ))}
              </ul>
            )}
            {confirmed && (
              <p className="text-xs mt-2 text-gray-600">
                Confirmed by {f.confirmedByRole?.toLowerCase() ?? "reviewer"}
                {f.confirmedAt ? ` on ${new Date(f.confirmedAt).toLocaleString("en-IN")}` : ""}: {f.confirmationNote}
              </p>
            )}
            {open === f.id && (
              <div className="mt-3 space-y-2">
                <label htmlFor={`flag-note-${f.id}`} className="block text-xs font-semibold">
                  {f.code === "BUDGET_CONFLICT"
                    ? "Which budget is correct? (edit the budget fields first if needed)"
                    : f.code === "PROMPT_INJECTION_SUSPECTED"
                    ? "Confirm you have checked the extracted fields (the instruction text was not applied)"
                    : "Your confirmation"}
                </label>
                <textarea
                  id={`flag-note-${f.id}`}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={note.trim().length < 5 || !!busy}
                    onClick={async () => {
                      if (await onConfirm(f.id, note)) setOpen(null);
                    }}
                    className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-40"
                  >
                    {busy === `flag:${f.id}` ? "Saving…" : "Confirm"}
                  </button>
                  <button type="button" onClick={() => setOpen(null)} className="px-3 text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ExtractionErrorDetail({ requirement }: { requirement: RequirementDTO }) {
  const e = requirement.extractionError;
  if (!e) return <p className="text-red-700">Document processing failed.</p>;
  return (
    <div className="space-y-1">
      <p className="text-red-700 font-semibold">
        {EXTRACTION_ERROR_LABELS[e.code] ?? "Document processing failed"}{" "}
        <span className="font-mono text-[10px] text-red-700">({e.code})</span>
      </p>
      <p className="text-xs text-gray-700">{e.message}</p>
    </div>
  );
}
