"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ADM-004: ask a VERIFIED organisation to re-verify. Sets the same
 * re-verification fields the platform's own reversal uses; the NGO keeps its
 * VERIFIED status, lands in the verification queue as a re-decision, and sees
 * a "re-verification due" notice with what to do.
 */
export default function RequestReverification({
  ngoId,
  verificationStatus,
  dueAt,
  reason,
}: {
  ngoId: string;
  verificationStatus: string;
  dueAt: string | null;
  reason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (dueAt) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-2xl p-4 text-sm text-amber-900 dark:text-amber-200">
        <b>Re-verification due</b> by {new Date(dueAt).toLocaleDateString("en-IN")}. {reason}
        <span className="block text-xs mt-1">Re-decide it from the <a className="underline" href="/admin/verification">verification queue</a>.</span>
      </div>
    );
  }
  if (verificationStatus !== "VERIFIED") return null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ngos/${ngoId}/request-reverification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: text, dueInDays: Number(days) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4">
      {!open ? (
        <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-amber-600 text-amber-700">
          Request re-verification
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Request re-verification</p>
          <p className="text-xs text-gray-500">The organisation stays VERIFIED and is not suspended. It sees your reason and the deadline; you re-decide in the verification queue.</p>
          <textarea className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm" rows={2} placeholder="Reason shown to the NGO (e.g. annual review: upload your current 80G certificate)" value={text} onChange={(e) => setText(e.target.value)} />
          <label className="text-xs">Due in <input className="w-16 border rounded px-1" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" /> days</label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy} onClick={submit} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-amber-600 text-white disabled:opacity-50">{busy ? "Saving…" : "Confirm"}</button>
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg text-sm border">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
