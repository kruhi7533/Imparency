"use client";

import React, { useState } from "react";

interface AskNgoBoxProps {
  ngoId: string;
  ngoName: string;
  /** Thread subject shown in both inquiry inboxes, e.g. `Question about project "X"` */
  subject?: string;
  /** Optional entity the question is anchored to: "PROJECT" | "FCRA" | "NGO_VERIFICATION" | "RISK_REVIEW" */
  entityType?: string;
  entityId?: string;
  buttonLabel?: string;
  buttonClassName?: string;
}

/**
 * Small direct-inquiry box that can sit next to any NGO shown in the admin
 * console. Opens a ReviewThread with that NGO via /api/admin/ngos/[id]/inquiry;
 * the conversation then lives in the shared Inquiries inbox on both sides.
 */
export default function AskNgoBox({
  ngoId,
  ngoName,
  subject,
  entityType,
  entityId,
  buttonLabel = "✉️ Ask NGO",
  buttonClassName,
}: AskNgoBoxProps) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const close = () => {
    setOpen(false);
    setQuestion("");
    setError("");
    setSent(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/ngos/${ngoId}/inquiry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), subject, entityType, entityId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to send inquiry");
      setSent(true);
      setQuestion("");
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Send a direct inquiry to ${ngoName}`}
        className={
          buttonClassName ||
          "bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-bold py-1.5 px-3 rounded-lg text-xs transition border border-amber-100/50 dark:border-amber-900/20"
        }
      >
        {buttonLabel}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 dark:border-gray-800 text-left">
            <h3 className="text-lg font-extrabold text-gray-900 dark:text-white mb-1">
              Ask NGO a Question
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Sending a direct inquiry to{" "}
              <span className="font-semibold text-gray-700 dark:text-gray-300">{ngoName}</span>
              {subject && (
                <>
                  {" "}regarding{" "}
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{subject}</span>
                </>
              )}
              . The NGO replies from their dashboard and the thread appears in your Inquiries inbox.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 text-xs text-red-600 dark:text-red-400 rounded">
                {error}
              </div>
            )}

            {sent ? (
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-xl text-sm font-semibold text-center">
                  Inquiry sent to {ngoName} successfully.
                </div>
                <div className="flex gap-3">
                  <a
                    href="/admin/inquiries"
                    className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold text-center transition"
                  >
                    View in Inquiries
                  </a>
                  <button
                    onClick={close}
                    className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold hover:bg-gray-200 dark:hover:bg-gray-700 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSend} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Your Question *
                  </label>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    rows={4}
                    required
                    autoFocus
                    placeholder="e.g. Could you clarify the details on this document / project / certificate?"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 transition resize-none"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 rounded-xl text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                  >
                    {loading && <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />}
                    Send Question
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
