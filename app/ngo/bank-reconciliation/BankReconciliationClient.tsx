"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type LineStatus = "MATCHED" | "AMOUNT_MISMATCH" | "AMBIGUOUS" | "UNMATCHED" | "DEBIT";

type View = {
  canReconcile: boolean;
  imports: Array<{ id: string; fileName: string; lineCount: number; newLineCount: number; matchedCount: number; createdAt: string }>;
  lines: Array<{
    id: string;
    valueDate: string;
    description: string;
    reference: string | null;
    amount: number;
    status: LineStatus;
    note: string | null;
    matched: { paymentId: string; contractId: string; contractNumber: string } | null;
  }>;
  pending: Array<{ id: string; amount: number; reference: string | null; paidAt: string; contractId: string; contractNumber: string; milestone: string | null }>;
};

type Result = {
  lineCount: number;
  newLines: number;
  duplicateLines: number;
  skippedRows: number;
  matched: Array<{ paymentId: string; contractId: string; amount: string; reference: string | null }>;
  amountMismatch: number;
  ambiguous: number;
  unmatched: number;
};

const inr = (n: number | string) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "UTC" });

const STATUS: Record<LineStatus, { label: string; cls: string }> = {
  MATCHED: { label: "Matched — reconciled", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  AMOUNT_MISMATCH: { label: "Amount mismatch", cls: "bg-red-50 text-red-700 border-red-200" },
  AMBIGUOUS: { label: "Needs your review", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  UNMATCHED: { label: "No matching payment", cls: "bg-gray-100 text-gray-600 border-gray-300" },
  DEBIT: { label: "Debit", cls: "bg-gray-100 text-gray-500 border-gray-300" },
};

/**
 * Upload a statement, see what reconciled and why the rest did not. The page
 * never reconciles anything itself — the server decides, and only on an exact
 * reference + amount + date match.
 */
export default function BankReconciliationClient({ view }: { view: View }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "upload" | "rematch">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");

  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ngo/bank-statements", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setResult(data);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function rematch() {
    setBusy("rematch");
    setError(null);
    try {
      const res = await fetch("/api/ngo/bank-statements/rematch", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not re-run matching.");
      setResult({ lineCount: 0, newLines: 0, duplicateLines: 0, skippedRows: 0, ...data });
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const lines = filter === "OPEN" ? view.lines.filter((l) => l.status !== "MATCHED") : view.lines;

  return (
    <div className="py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-gray-900">Bank reconciliation</h1>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            Upload your bank statement to check donor-recorded contract payments against what actually reached your account. A
            payment is reconciled automatically only when a credit carries its reference, for exactly its amount, within 7 days of
            the date the donor entered. Anything less certain is left for you to review.
          </p>
        </div>

        {view.canReconcile ? (
          <div className="border border-gray-200/80 bg-white rounded-2xl p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-sm text-gray-700">
              <p className="font-bold text-gray-900">Upload a statement (CSV)</p>
              <p className="text-xs text-gray-500 mt-1">
                Needs a Date column, a Narration/Description column, and Credit/Debit (or Amount with Cr/Dr) columns. Re-uploading an
                overlapping period is safe — lines already imported are skipped.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <button
                type="button"
                disabled={!!busy}
                onClick={() => fileRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy === "upload" ? "Matching…" : "Upload statement"}
              </button>
              <button
                type="button"
                disabled={!!busy || view.lines.length === 0}
                onClick={rematch}
                title="Re-check open lines against payments recorded since your last upload"
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 text-sm font-semibold disabled:opacity-40"
              >
                {busy === "rematch" ? "Re-checking…" : "Re-run matching"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-amber-700 border border-amber-200 bg-amber-50 rounded-2xl px-5 py-3">
            Only your organisation&apos;s owner, admins or finance team can upload statements.
          </p>
        )}

        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}

        {result && (
          <div className="border border-emerald-200 bg-emerald-50 rounded-2xl p-5 text-sm text-gray-800 space-y-2">
            {result.lineCount > 0 && (
              <p>
                Read {result.lineCount} transactions — {result.newLines} new
                {result.duplicateLines > 0 ? `, ${result.duplicateLines} already imported` : ""}
                {result.skippedRows > 0 ? `, ${result.skippedRows} rows skipped (balances or unreadable)` : ""}.
              </p>
            )}
            <p>
              <span className="font-bold text-emerald-700">
                {result.matched.length} payment{result.matched.length === 1 ? "" : "s"} reconciled
              </span>
              {result.amountMismatch > 0 && <span className="text-red-700"> · {result.amountMismatch} amount mismatch</span>}
              {result.ambiguous > 0 && <span className="text-amber-700"> · {result.ambiguous} need your review</span>}
              {result.unmatched > 0 && <span className="text-gray-600"> · {result.unmatched} credits with no recorded payment</span>}
            </p>
            {result.matched.map((m) => (
              <p key={m.paymentId} className="text-xs text-emerald-700">
                ✓ {inr(m.amount)} · ref {m.reference} —{" "}
                <Link href={`/ngo/contracts/${m.contractId}`} className="underline">
                  view contract
                </Link>
              </p>
            ))}
          </div>
        )}

        <div className="border border-gray-200/80 bg-white rounded-2xl p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-3">
          <p className="text-sm font-bold text-gray-900">Payments waiting for a match ({view.pending.length})</p>
          {view.pending.length === 0 ? (
            <p className="text-xs text-gray-500">No donor-recorded transfers are waiting for confirmation.</p>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1"><table className="w-full min-w-[560px] text-xs text-left text-gray-700">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="py-1 font-semibold">Contract</th>
                  <th className="py-1 font-semibold">Milestone</th>
                  <th className="py-1 font-semibold">Amount</th>
                  <th className="py-1 font-semibold">Reference</th>
                  <th className="py-1 font-semibold">Paid on (per donor)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {view.pending.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5">
                      <Link href={`/ngo/contracts/${p.contractId}`} className="text-trust-700 hover:underline">
                        {p.contractNumber}
                      </Link>
                    </td>
                    <td className="py-1.5">{p.milestone ?? "—"}</td>
                    <td className="py-1.5">{inr(p.amount)}</td>
                    <td className="py-1.5 font-mono">{p.reference ?? "—"}</td>
                    <td className="py-1.5">{day(p.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="text-[11px] text-gray-500">Can&apos;t find one on your statement? You can still confirm or dispute it on the contract page.</p>
        </div>

        <div className="border border-gray-200/80 bg-white rounded-2xl p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-gray-900">Statement credits</p>
            <div className="flex gap-1 text-xs">
              {(["OPEN", "ALL"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full border ${
                    filter === f ? "border-trust-200 text-trust-700 bg-trust-50" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {f === "OPEN" ? "Open" : "All"}
                </button>
              ))}
            </div>
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-gray-500">{view.lines.length === 0 ? "No statement uploaded yet." : "Every credit is matched."}</p>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-gray-800">
                      <span className="font-bold">{inr(l.amount)}</span> · {day(l.valueDate)}
                      {l.reference && <span className="font-mono text-gray-600"> · {l.reference}</span>}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS[l.status].cls}`}>{STATUS[l.status].label}</span>
                  </div>
                  <p className="text-gray-500 mt-1 break-words">{l.description}</p>
                  {l.note && <p className="text-gray-600 mt-1">{l.note}</p>}
                  {l.matched && (
                    <p className="mt-1">
                      <Link href={`/ngo/contracts/${l.matched.contractId}`} className="text-trust-700 hover:underline">
                        {l.matched.contractNumber}
                      </Link>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {view.imports.length > 0 && (
          <p className="text-[11px] text-gray-500">
            Last upload: {view.imports[0].fileName} on {new Date(view.imports[0].createdAt).toLocaleString("en-IN")} —{" "}
            {view.imports[0].newLineCount} new lines, {view.imports[0].matchedCount} reconciled.
          </p>
        )}
      </div>
    </div>
  );
}
