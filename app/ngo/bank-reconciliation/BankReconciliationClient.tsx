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
  MATCHED: { label: "Matched — reconciled", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  AMOUNT_MISMATCH: { label: "Amount mismatch", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  AMBIGUOUS: { label: "Needs your review", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  UNMATCHED: { label: "No matching payment", cls: "bg-gray-800 text-gray-400 border-gray-700" },
  DEBIT: { label: "Debit", cls: "bg-gray-800 text-gray-500 border-gray-700" },
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
    <div className="min-h-screen bg-gray-950 py-10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white">Bank reconciliation</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-3xl">
            Upload your bank statement to check donor-recorded contract payments against what actually reached your account. A
            payment is reconciled automatically only when a credit carries its reference, for exactly its amount, within 7 days of
            the date the donor entered. Anything less certain is left for you to review.
          </p>
        </div>

        {view.canReconcile ? (
          <div className="border border-gray-800 bg-gray-900/40 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-sm text-gray-300">
              <p className="font-bold text-white">Upload a statement (CSV)</p>
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
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 text-sm font-bold disabled:opacity-50"
              >
                {busy === "upload" ? "Matching…" : "Upload statement"}
              </button>
              <button
                type="button"
                disabled={!!busy || view.lines.length === 0}
                onClick={rematch}
                title="Re-check open lines against payments recorded since your last upload"
                className="px-4 py-2 rounded-xl border border-gray-700 text-gray-200 text-sm font-semibold disabled:opacity-40"
              >
                {busy === "rematch" ? "Re-checking…" : "Re-run matching"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-2xl px-5 py-3">
            Only your organisation&apos;s owner, admins or finance team can upload statements.
          </p>
        )}

        {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-4 py-2">{error}</p>}

        {result && (
          <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-2xl p-5 text-sm text-gray-200 space-y-2">
            {result.lineCount > 0 && (
              <p>
                Read {result.lineCount} transactions — {result.newLines} new
                {result.duplicateLines > 0 ? `, ${result.duplicateLines} already imported` : ""}
                {result.skippedRows > 0 ? `, ${result.skippedRows} rows skipped (balances or unreadable)` : ""}.
              </p>
            )}
            <p>
              <span className="font-bold text-emerald-300">
                {result.matched.length} payment{result.matched.length === 1 ? "" : "s"} reconciled
              </span>
              {result.amountMismatch > 0 && <span className="text-red-300"> · {result.amountMismatch} amount mismatch</span>}
              {result.ambiguous > 0 && <span className="text-amber-300"> · {result.ambiguous} need your review</span>}
              {result.unmatched > 0 && <span className="text-gray-400"> · {result.unmatched} credits with no recorded payment</span>}
            </p>
            {result.matched.map((m) => (
              <p key={m.paymentId} className="text-xs text-emerald-200/80">
                ✓ {inr(m.amount)} · ref {m.reference} —{" "}
                <Link href={`/ngo/contracts/${m.contractId}`} className="underline">
                  view contract
                </Link>
              </p>
            ))}
          </div>
        )}

        <div className="border border-gray-800 bg-gray-900/40 rounded-2xl p-5 space-y-3">
          <p className="text-sm font-bold text-white">Payments waiting for a match ({view.pending.length})</p>
          {view.pending.length === 0 ? (
            <p className="text-xs text-gray-500">No donor-recorded transfers are waiting for confirmation.</p>
          ) : (
            <table className="w-full text-xs text-left text-gray-300">
              <thead className="text-gray-500">
                <tr>
                  <th className="py-1 font-semibold">Contract</th>
                  <th className="py-1 font-semibold">Milestone</th>
                  <th className="py-1 font-semibold">Amount</th>
                  <th className="py-1 font-semibold">Reference</th>
                  <th className="py-1 font-semibold">Paid on (per donor)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {view.pending.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1.5">
                      <Link href={`/ngo/contracts/${p.contractId}`} className="text-emerald-400 hover:underline">
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
            </table>
          )}
          <p className="text-[11px] text-gray-500">Can&apos;t find one on your statement? You can still confirm or dispute it on the contract page.</p>
        </div>

        <div className="border border-gray-800 bg-gray-900/40 rounded-2xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-white">Statement credits</p>
            <div className="flex gap-1 text-xs">
              {(["OPEN", "ALL"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full border ${
                    filter === f ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-gray-700 text-gray-400"
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
                <div key={l.id} className="rounded-xl border border-gray-800 bg-gray-950/40 px-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-gray-200">
                      <span className="font-bold">{inr(l.amount)}</span> · {day(l.valueDate)}
                      {l.reference && <span className="font-mono text-gray-400"> · {l.reference}</span>}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${STATUS[l.status].cls}`}>{STATUS[l.status].label}</span>
                  </div>
                  <p className="text-gray-500 mt-1 break-words">{l.description}</p>
                  {l.note && <p className="text-gray-400 mt-1">{l.note}</p>}
                  {l.matched && (
                    <p className="mt-1">
                      <Link href={`/ngo/contracts/${l.matched.contractId}`} className="text-emerald-400 hover:underline">
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
