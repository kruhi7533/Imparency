"use client";

import React, { useState } from "react";

interface SubmitProofModalProps {
  milestoneId: string;
  milestoneTitle: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SubmitProofModal({
  milestoneId,
  milestoneTitle,
  onClose,
  onSuccess,
}: SubmitProofModalProps) {
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiResult, setAiResult] = useState<{
    score: number;
    reasoning: string;
    flags: string[];
    suggestion?: string;
    status: string;
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError("");
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      if (selectedFiles.length > 5) {
        setError("You can only upload up to 5 files.");
        return;
      }
      let total = 0;
      for (const f of selectedFiles) {
        if (f.size > 5 * 1024 * 1024) {
          setError(`File ${f.name} exceeds 5MB limit.`);
          return;
        }
        total += f.size;
      }
      if (total > 20 * 1024 * 1024) {
        setError("Combined file size exceeds the 20MB limit.");
        return;
      }
      setFiles(selectedFiles);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!description.trim()) {
      setError("Please write a brief description of the completed milestone work.");
      setLoading(false);
      return;
    }

    if (files.length === 0) {
      setError("Please select at least one photo or document file as proof.");
      setLoading(false);
      return;
    }

    const formData = new FormData();
    formData.append("milestoneId", milestoneId);
    formData.append("description", description.trim());
    
    files.forEach((file) => {
      formData.append("files", file);
    });

    try {
      const res = await fetch("/api/ngo/submit-proof", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit proof");
      }

      setAiResult(data);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 w-full max-w-lg rounded-3xl p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        
        {!loading && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
          >
            ✕
          </button>
        )}

        {!aiResult ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white">Submit Milestone Proof</h3>
              <p className="text-xs text-gray-400 mt-1">Milestone: {milestoneTitle}</p>
            </div>

            {error && (
              <div className="p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 rounded-xl text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-450 uppercase tracking-wider mb-2">Description of Completion *</label>
                <textarea
                  required
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide details of how this milestone was executed, items purchased, or beneficiaries impacted..."
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-450 uppercase tracking-wider mb-2">
                  Upload Proof Files (Photos/PDFs) *
                </label>
                <input
                  type="file"
                  multiple
                  required
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 dark:file:bg-emerald-950/20 dark:file:text-emerald-400 cursor-pointer"
                />
                <span className="block text-[10px] text-gray-400 mt-1.5">
                  Max 5 files. Max 5MB per file. Combined total limit: 20MB. Supports PNG, JPG, WebP, and PDF.
                </span>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 rounded-2xl shadow-lg transition disabled:opacity-50 text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>AI Agent Auditing Proof...</span>
                </>
              ) : (
                "Submit Proof for AI Audit"
              )}
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white">AI Evaluation Completed</h3>
              <p className="text-xs text-gray-400 mt-1">Audit result for: {milestoneTitle}</p>
            </div>

            <div className="flex flex-col items-center py-6 border-b border-gray-100 dark:border-gray-800">
              <span className={`text-5xl font-black tracking-tight ${
                aiResult.score >= 70 
                  ? "text-emerald-600 dark:text-emerald-400" 
                  : "text-amber-500"
              }`}>
                {aiResult.score}
              </span>
              <span className="text-[10px] font-bold text-gray-400 mt-1">AUDIT SCORE (MIN 70)</span>
              
              <span className={`mt-3 text-xs font-bold px-3 py-1 rounded-full uppercase ${
                aiResult.score >= 70
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                  : "bg-amber-50 text-amber-700 border border-amber-100"
              }`}>
                {aiResult.score >= 70 ? "Auto-Approved" : "Under Review"}
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <strong className="block text-gray-500 font-bold uppercase tracking-wider mb-1">AI Reasoning:</strong>
                <p className="text-gray-700 dark:text-gray-300 leading-relaxed bg-gray-50 dark:bg-gray-950 p-3.5 rounded-2xl">
                  {aiResult.reasoning}
                </p>
              </div>

              {aiResult.flags && aiResult.flags.length > 0 && (
                <div>
                  <strong className="block text-red-500 font-bold uppercase tracking-wider mb-1">Flagged Concerns:</strong>
                  <ul className="list-disc list-inside space-y-1 text-red-600 dark:text-red-400">
                    {aiResult.flags.map((flag, i) => (
                      <li key={i}>{flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              {aiResult.suggestion && (
                <div>
                  <strong className="block text-amber-600 font-bold uppercase tracking-wider mb-1">Actionable Suggestion:</strong>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100/50 dark:border-amber-900/30 p-3.5 rounded-2xl font-semibold">
                    {aiResult.suggestion}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                onSuccess();
                onClose();
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3.5 rounded-2xl shadow-lg transition text-sm"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
