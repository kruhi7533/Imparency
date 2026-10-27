"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

interface ChainBreak {
  seq: number | null;
  id: string | null;
  reason: string;
  detail: string;
}
interface ChainResult {
  ok: boolean;
  checkedRows: number;
  head: { seq: number; hash: string } | null;
  firstBreak: ChainBreak | null;
  checkpoints: { total: number; signed: number; verified: number; keyConfigured: boolean };
}
interface ExportProblem {
  line: number | null;
  seq: number | null;
  id: string | null;
  reason: string;
  detail: string;
}
interface ExportResult {
  ok: boolean;
  rowsChecked: number;
  filtered: boolean | null;
  problems: ExportProblem[];
}

const btn =
  "min-h-[40px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50";

export default function IntegrityClient() {
  const router = useRouter();
  const [verifying, setVerifying] = useState(false);
  const [chain, setChain] = useState<ChainResult | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  const [checkpointing, setCheckpointing] = useState(false);
  const [checkpointMsg, setCheckpointMsg] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const verify = async () => {
    setVerifying(true);
    setChainError(null);
    setChain(null);
    try {
      const res = await fetch("/api/admin/audit/verify");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Verification failed (${res.status})`);
      setChain(data);
      router.refresh();
    } catch (e: any) {
      setChainError(e.message);
    } finally {
      setVerifying(false);
    }
  };

  const checkpoint = async () => {
    setCheckpointing(true);
    setCheckpointMsg(null);
    try {
      const res = await fetch("/api/admin/audit/checkpoint", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setCheckpointMsg(`Checkpoint recorded at seq ${data.checkpoint.seq}${data.signed ? " (signed)" : " (unsigned — no AUDIT_CHAIN_KEY)"}.`);
      router.refresh();
    } catch (e: any) {
      setCheckpointMsg(e.message);
    } finally {
      setCheckpointing(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setExportError(null);
    setExportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/audit/verify-export", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Verification failed (${res.status})`);
      setExportResult(data);
    } catch (e: any) {
      setExportError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Verify the live chain</h2>
        <p className="mt-1 text-xs text-gray-500">Recomputes every row&apos;s hash in the database and checks links, gaps, the head and signed checkpoints.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={verify} disabled={verifying} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {verifying ? "Verifying…" : "Verify"}
          </button>
          <button type="button" onClick={checkpoint} disabled={checkpointing} className={`${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`}>
            {checkpointing ? "Recording…" : "Record checkpoint"}
          </button>
        </div>
        <div role="status" aria-live="polite" className="mt-3 text-sm">
          {chainError && <p className="text-red-600">{chainError}</p>}
          {checkpointMsg && <p className="text-gray-600 dark:text-gray-300">{checkpointMsg}</p>}
          {chain && chain.ok && (
            <p className="font-semibold text-emerald-600">
              OK — {chain.checkedRows} rows intact up to seq {chain.head?.seq ?? 0}. Checkpoints: {chain.checkpoints.total} ({chain.checkpoints.verified} signature-verified).
            </p>
          )}
          {chain && !chain.ok && chain.firstBreak && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <p className="font-semibold">
                BROKEN at seq {chain.firstBreak.seq ?? "?"} — {chain.firstBreak.reason}
              </p>
              {chain.firstBreak.id && <p className="font-mono text-xs">row {chain.firstBreak.id}</p>}
              <p className="mt-1 text-xs">{chain.firstBreak.detail}</p>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Verify an exported CSV</h2>
        <p className="mt-1 text-xs text-gray-500">
          Upload a file from <span className="font-mono">Export CSV</span> on the audit trail. Edited, deleted or reordered rows are reported by line and seq.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-gray-700 dark:text-gray-200"
            aria-label="Exported audit CSV"
          />
          <button type="button" onClick={upload} disabled={!file || uploading} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {uploading ? "Checking…" : "Verify file"}
          </button>
        </div>
        <div role="status" aria-live="polite" className="mt-3 text-sm">
          {exportError && <p className="text-red-600">{exportError}</p>}
          {exportResult && exportResult.ok && (
            <p className="font-semibold text-emerald-600">
              OK — {exportResult.rowsChecked} rows match their hashes and the database{exportResult.filtered ? " (filtered export)" : ""}.
            </p>
          )}
          {exportResult && !exportResult.ok && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <p className="font-semibold">{exportResult.problems.length} problem(s) in {exportResult.rowsChecked} rows</p>
              <ul className="mt-1 space-y-1 text-xs">
                {exportResult.problems.slice(0, 20).map((p, i) => (
                  <li key={i}>
                    <span className="font-semibold">{p.reason}</span>
                    {p.line !== null && <> · line {p.line}</>}
                    {p.seq !== null && <> · seq {p.seq}</>} — {p.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
