"use client";

import React, { useState } from "react";
import { Sparkles, MessageSquarePlus } from "lucide-react";

/**
 * Two on-demand AI actions for a quiet/overdue NGO row:
 * - Trust Insight: plain-English read of the NGO's reliability signals.
 * - Draft reminder: AI-written nudge the admin can copy, edit, and send.
 * Both are advisory only — nothing here sends anything automatically.
 */
export default function NgoAgentActions({
  ngoId,
  reason,
}: {
  ngoId: string;
  reason: "QUIET" | "OVERDUE_MILESTONE";
}) {
  const [insight, setInsight] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState<"insight" | "draft" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function getInsight() {
    setLoading("insight");
    setError("");
    try {
      const res = await fetch(`/api/admin/ngos/${ngoId}/trust-insight`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate insight");
      setInsight(data.insight);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(null);
    }
  }

  async function getDraft() {
    setLoading("draft");
    setError("");
    try {
      const res = await fetch(`/api/admin/ngos/${ngoId}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to draft reminder");
      setDraft(data.draft);
      setCopied(false);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(null);
    }
  }

  function copyDraft() {
    if (!draft) return;
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="w-full mt-2">
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={getInsight}
          disabled={loading !== null}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-blue-200 dark:border-blue-900/40 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition disabled:opacity-50"
        >
          <Sparkles size={12} />
          {loading === "insight" ? "Analyzing…" : "Trust insight"}
        </button>
        <button
          onClick={getDraft}
          disabled={loading !== null}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border border-emerald-200 dark:border-emerald-900/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition disabled:opacity-50"
        >
          <MessageSquarePlus size={12} />
          {loading === "draft" ? "Drafting…" : "Draft reminder"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}

      {insight && (
        <div className="mt-2 rounded-lg bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 px-3 py-2">
          <p className="text-[10px] font-extrabold uppercase tracking-wide text-blue-500 mb-0.5">Trust Insight</p>
          <p className="text-xs text-gray-700 dark:text-gray-300">{insight}</p>
        </div>
      )}

      {draft && (
        <div className="mt-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 px-3 py-2">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-600">Draft Reminder (edit before sending)</p>
            <button onClick={copyDraft} className="text-[10px] font-bold text-emerald-600 hover:underline">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{draft}</p>
        </div>
      )}
    </div>
  );
}
