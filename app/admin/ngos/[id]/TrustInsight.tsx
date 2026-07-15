"use client";

import { useState } from "react";

/** On-demand AI trust read for an NGO — advisory only, never changes status. */
export default function TrustInsight({ ngoId }: { ngoId: string }) {
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function fetchInsight() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ngos/${ngoId}/trust-insight`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate insight");
      setInsight(data.insight);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-950/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-blue-700 dark:text-blue-400">AI Trust Insight</p>
        <button
          onClick={fetchInsight}
          disabled={loading}
          className="px-3 py-1 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
        >
          {loading ? "Analyzing…" : insight ? "Refresh" : "Get insight"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
      {insight && <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{insight}</p>}
      {!insight && !error && (
        <p className="mt-2 text-xs text-gray-400">
          Synthesizes health score, compliance, fraud alerts, and milestone delivery into a plain-English read.
        </p>
      )}
    </div>
  );
}
