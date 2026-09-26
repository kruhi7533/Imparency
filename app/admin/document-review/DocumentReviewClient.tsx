"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface FieldFlag {
  severity: "LOW" | "MEDIUM" | "HIGH";
  issue: string;
}

interface ExtractedFieldRow {
  id: string;
  fieldKey: string;
  extractedValue: string | null;
  submittedValue: string | null;
  matchesSubmitted: boolean | null;
  confidence: number;
  status: string;
  flags: FieldFlag[];
  validatedValue: string | null;
  validatedAt: string | null;
}

interface DocumentAnalysisRow {
  id: string;
  documentIndex: number;
  documentUrl: string;
  docType: string;
  docTypeConfidence: number;
  readable: boolean;
  note: string | null;
}

interface NgoRow {
  id: string;
  orgName: string;
  email: string;
  verificationStatus: string;
  documents: string[];
  /** False when extraction never produced any field rows for this NGO. */
  hasExtraction: boolean;
  analyses: DocumentAnalysisRow[];
  fields: ExtractedFieldRow[];
}

const FIELD_LABELS: Record<string, string> = {
  orgName: "Organisation name",
  registrationNumber: "Registration number",
  panNumber: "PAN number",
  a12Number: "12A number",
  eightyGNumber: "80G number",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  REGISTRATION_CERTIFICATE: "Registration certificate",
  PAN_CARD: "PAN card",
  TAX_EXEMPTION_12A: "12A certificate",
  TAX_EXEMPTION_80G: "80G certificate",
  FCRA_CERTIFICATE: "FCRA certificate",
  BANK_PROOF: "Bank proof",
  UNKNOWN: "Unclassified",
};

const STATUS_BADGE: Record<string, string> = {
  VALIDATED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
  EXTRACTED: "bg-sky-100 text-sky-800 dark:bg-sky-950/30 dark:text-sky-400",
  NEEDS_REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-950/25 dark:text-amber-400",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  VALIDATED: "Validated",
  EXTRACTED: "Read clearly",
  NEEDS_REVIEW: "Needs review",
  REJECTED: "Rejected",
};

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: "text-red-600 dark:text-red-400",
  MEDIUM: "text-amber-600 dark:text-amber-400",
  LOW: "text-gray-500 dark:text-gray-400",
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.75
      ? "bg-emerald-500"
      : value >= 0.4
      ? "bg-amber-500"
      : "bg-red-500";
  return (
    <div className="flex items-center gap-2 min-w-[92px]">
      <div className="h-1.5 w-14 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

export default function DocumentReviewClient({ initialNgos }: { initialNgos: NgoRow[] }) {
  const router = useRouter();
  const [ngos, setNgos] = useState<NgoRow[]>(initialNgos);
  const [expanded, setExpanded] = useState<string | null>(
    initialNgos.find((n) => !n.hasExtraction)?.id ??
      initialNgos.find((n) => n.fields.some((f) => f.status === "NEEDS_REVIEW"))?.id ??
      initialNgos[0]?.id ??
      null
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyFieldId, setBusyFieldId] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [error, setError] = useState("");

  const pendingCount = (ngo: NgoRow) =>
    ngo.fields.filter((f) => f.status === "NEEDS_REVIEW").length;

  async function decide(ngoId: string, field: ExtractedFieldRow, action: "VALIDATE" | "REJECT") {
    setBusyFieldId(field.id);
    setError("");
    try {
      const corrected = edits[field.id]?.trim();
      const res = await fetch(`/api/admin/ngo-fields/${field.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          correctedValue: corrected && corrected !== field.extractedValue ? corrected : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save that decision.");
        return;
      }

      setNgos((prev) =>
        prev.map((n) =>
          n.id !== ngoId
            ? n
            : {
                ...n,
                fields: n.fields.map((f) =>
                  f.id === field.id
                    ? {
                        ...f,
                        status: data.field.status,
                        validatedValue: data.field.validatedValue,
                        validatedAt: data.field.validatedAt,
                      }
                    : f
                ),
              }
        )
      );
      router.refresh();
    } catch {
      setError("Network error while saving that decision.");
    } finally {
      setBusyFieldId(null);
    }
  }

  async function rerun(ngoId: string) {
    setRerunning(ngoId);
    setError("");
    try {
      const res = await fetch("/api/admin/extract-ngo-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ngoId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Re-run failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error while re-running extraction.");
    } finally {
      setRerunning(null);
    }
  }

  if (ngos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          No NGO documents to review yet.
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          NGOs appear here as soon as they upload registration documents, whether or not
          extraction has run.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {ngos.map((ngo) => {
        const outstanding = pendingCount(ngo);
        const isOpen = expanded === ngo.id;

        return (
          <section
            key={ngo.id}
            className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : ngo.id)}
              className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-900 dark:text-white truncate">
                    {ngo.orgName}
                  </span>
                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {ngo.verificationStatus}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {ngo.email}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {!ngo.hasExtraction ? (
                  <span className="text-xs font-bold text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/30 px-2 py-1 rounded-full">
                    Not analysed
                  </span>
                ) : outstanding > 0 ? (
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/25 px-2 py-1 rounded-full">
                    {outstanding} to review
                  </span>
                ) : (
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/30 px-2 py-1 rounded-full">
                    All reviewed
                  </span>
                )}
                <span className="text-gray-400 text-sm">{isOpen ? "▲" : "▼"}</span>
              </div>
            </button>

            {/* Extraction never produced anything — offer to start it. Without
                this the NGO had no rows, so it rendered no actions at all. */}
            {isOpen && !ngo.hasExtraction && (
              <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-6">
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Extraction has never run for this NGO.
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
                  {ngo.documents.length} document
                  {ngo.documents.length === 1 ? " was" : "s were"} uploaded, but no fields
                  were read from them — the automatic run never completed. Nothing has been
                  reviewed and no compliance flag can be earned until it does.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => rerun(ngo.id)}
                    disabled={rerunning === ngo.id}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition"
                  >
                    {rerunning === ngo.id ? "Running…" : "Run extraction"}
                  </button>
                  {ngo.documents.map((url, i) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                    >
                      Open document #{i + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {isOpen && ngo.hasExtraction && (
              <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-5 space-y-6">
                {/* Documents the agent classified */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-gray-400">
                      Uploaded documents
                    </h3>
                    <button
                      type="button"
                      onClick={() => rerun(ngo.id)}
                      disabled={rerunning === ngo.id}
                      className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                    >
                      {rerunning === ngo.id ? "Re-running…" : "Re-run extraction"}
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {ngo.analyses.length === 0 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        No documents were analysed.
                      </p>
                    )}
                    {ngo.analyses.map((a) => (
                      <div
                        key={a.id}
                        className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {DOC_TYPE_LABELS[a.docType] || a.docType}
                          </span>
                          {!a.readable && (
                            <span className="text-[10px] font-black text-red-600 dark:text-red-400">
                              UNREADABLE
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5">
                          <ConfidenceBar value={a.docTypeConfidence} />
                        </div>
                        {a.note && (
                          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{a.note}</p>
                        )}
                        {a.documentUrl && (
                          <a
                            href={a.documentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-block text-xs font-semibold text-emerald-600 hover:text-emerald-700"
                          >
                            Open document #{a.documentIndex + 1}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Field-by-field human gate */}
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-gray-400 mb-2">
                    Extracted fields
                  </h3>
                  <div className="space-y-3">
                    {ngo.fields.map((f) => {
                      const decided = f.status === "VALIDATED" || f.status === "REJECTED";
                      const displayValue = f.validatedValue ?? f.extractedValue;

                      return (
                        <div
                          key={f.id}
                          className="rounded-lg border border-gray-200 dark:border-gray-800 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-gray-900 dark:text-white">
                                {FIELD_LABELS[f.fieldKey] || f.fieldKey}
                              </span>
                              <span
                                className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                  STATUS_BADGE[f.status] || STATUS_BADGE.NEEDS_REVIEW
                                }`}
                              >
                                {STATUS_LABEL[f.status] || f.status}
                              </span>
                            </div>
                            <ConfidenceBar value={f.confidence} />
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2 mb-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">
                                Read from document
                              </p>
                              <p
                                className={`text-sm font-mono ${
                                  f.extractedValue
                                    ? "text-gray-900 dark:text-gray-100"
                                    : "text-gray-400 dark:text-gray-500 italic"
                                }`}
                              >
                                {f.extractedValue ?? "not found"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">
                                Typed on registration form
                              </p>
                              <p className="text-sm font-mono text-gray-600 dark:text-gray-300">
                                {f.submittedValue ?? "—"}
                                {f.matchesSubmitted === true && (
                                  <span className="ml-2 text-xs font-sans font-bold text-emerald-600">
                                    match
                                  </span>
                                )}
                                {f.matchesSubmitted === false && (
                                  <span className="ml-2 text-xs font-sans font-bold text-red-600">
                                    mismatch
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>

                          {f.flags.length > 0 && (
                            <ul className="mb-3 space-y-1">
                              {f.flags.map((flag, i) => (
                                <li
                                  key={i}
                                  className={`text-xs ${SEVERITY_COLOR[flag.severity] || ""}`}
                                >
                                  <span className="font-black">{flag.severity}</span> — {flag.issue}
                                </li>
                              ))}
                            </ul>
                          )}

                          {decided ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {f.status === "VALIDATED" ? "Validated" : "Rejected"} as{" "}
                              <span className="font-mono font-semibold">
                                {displayValue ?? "—"}
                              </span>
                              {f.validatedAt &&
                                ` on ${new Date(f.validatedAt).toLocaleDateString()}`}
                              .
                            </p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                value={edits[f.id] ?? f.extractedValue ?? ""}
                                onChange={(e) =>
                                  setEdits((prev) => ({ ...prev, [f.id]: e.target.value }))
                                }
                                placeholder="Enter the correct value"
                                className="flex-1 min-w-[200px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                              <button
                                type="button"
                                onClick={() => decide(ngo.id, f, "VALIDATE")}
                                disabled={busyFieldId === f.id}
                                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold text-white transition"
                              >
                                {busyFieldId === f.id ? "Saving…" : "Validate"}
                              </button>
                              <button
                                type="button"
                                onClick={() => decide(ngo.id, f, "REJECT")}
                                disabled={busyFieldId === f.id}
                                className="rounded-lg border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold transition"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
