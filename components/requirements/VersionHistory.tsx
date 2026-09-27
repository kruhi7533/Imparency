"use client";

import { useState } from "react";
import { REQUIREMENT_FIELDS, REQUIREMENT_FIELD_KEYS, type RequirementFields } from "@/lib/requirements/provenance";
import type { RevisionDTO } from "@/lib/requirements/dto";
import { formatValue } from "./FieldsEditor";

interface VersionEntry {
  version: number;
  note: string | null;
  role: string | null;
  who: string | null;
  at: string;
  fields: RequirementFields;
  current: boolean;
}

const ROLE_LABEL: Record<string, string> = { SYSTEM: "AI agent", DONOR: "Donor", ADMIN: "Admin" };

/** v3 — Admin verified · v2 — Donor corrected budget · v1 — AI extraction. Expand a version to see its values. */
export function VersionHistory({
  current,
  revisions,
}: {
  current: { version: number; versionNote: string | null; versionAuthorRole: string | null; updatedAt: string; fields: RequirementFields };
  revisions: RevisionDTO[];
}) {
  const [open, setOpen] = useState<number | null>(null);

  const entries: VersionEntry[] = [
    {
      version: current.version,
      note: current.versionNote,
      role: current.versionAuthorRole,
      who: null,
      at: current.updatedAt,
      fields: current.fields,
      current: true,
    },
    ...revisions.map((r) => ({
      version: r.version,
      note: r.changeSummary,
      role: r.changedByRole,
      who: r.changedBy?.name ?? null,
      at: r.createdAt,
      fields: r.fields,
      current: false,
    })),
  ];

  return (
    <ol className="space-y-2">
      {entries.map((e, i) => {
        const newer = i > 0 ? entries[i - 1] : null;
        const changedKeys = newer
          ? REQUIREMENT_FIELD_KEYS.filter((k) => JSON.stringify(newer.fields[k].value) !== JSON.stringify(e.fields[k].value))
          : [];
        return (
          <li key={`${e.version}-${i}`} className="border border-gray-800 rounded-xl bg-gray-950/40">
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <span className="font-mono text-xs font-bold text-blue-300 mr-2">v{e.version}</span>
                <span className="text-sm text-gray-100">{e.note ?? (e.version === 1 ? "AI extraction" : "Updated")}</span>
                {e.current && <span className="ml-2 text-[10px] font-bold text-emerald-400">CURRENT</span>}
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {e.role ? ROLE_LABEL[e.role] ?? e.role : "—"}
                  {e.who ? ` · ${e.who}` : ""} · {new Date(e.at).toLocaleString("en-IN")}
                  {!e.current && changedKeys.length > 0 && ` · ${changedKeys.length} field(s) changed in v${newer!.version}`}
                </p>
              </div>
              <span className="text-xs text-gray-500">{open === i ? "Hide" : "View"}</span>
            </button>
            {open === i && (
              <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                {REQUIREMENT_FIELD_KEYS.map((k) => (
                  <div key={k} className={changedKeys.includes(k) ? "text-amber-200" : "text-gray-300"}>
                    <span className="text-gray-500">{REQUIREMENT_FIELDS[k].label}: </span>
                    {formatValue(k, e.fields[k].value)}
                    <span className="text-gray-600"> ({e.fields[k].source.replace("_", " ").toLowerCase()})</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
