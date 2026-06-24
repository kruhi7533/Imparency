"use client";

import React, { useState } from "react";

interface AIGenerateFieldProps {
  fieldType: "description" | "problem_statement" | "expected_outcome" | "milestone_description";
  title: string;
  causeCategory: string;
  targetAmount: string | number;
  location?: string;
  currentValue: string;
  onGenerated: (newValue: string) => void;
  disabled?: boolean;

  // Milestone context
  milestoneTitle?: string;
  proofTypeRequired?: string;
  parentProjectTitle?: string;
}

export default function AIGenerateField({
  fieldType,
  title,
  causeCategory,
  targetAmount,
  location = "",
  currentValue,
  onGenerated,
  disabled = false,
  milestoneTitle,
  proofTypeRequired,
  parentProjectTitle,
}: AIGenerateFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (disabled) return null;

  const handleGenerate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!notes.trim()) {
      setError("Please enter a few quick points first.");
      return;
    }

    if (currentValue && currentValue.trim()) {
      const confirmOverwrite = window.confirm("This will replace your current text. Continue?");
      if (!confirmOverwrite) return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ai/generate-campaign-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_type: fieldType,
          user_input: notes.trim(),
          title,
          cause_category: causeCategory,
          target_amount: targetAmount,
          location,
          milestone_title: milestoneTitle,
          proof_type_required: proofTypeRequired,
          parent_project_title: parentProjectTitle,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Generation failed");
      }

      onGenerated(data.text || "");
      setIsOpen(false);
      setNotes(""); // Clear notes for next time
    } catch (err: any) {
      console.error("AI Copywriting generation error:", err);
      setError(err.message || "Generation failed, please try again or write manually.");
    } finally {
      setLoading(false);
    }
  };

  const placeholderText = () => {
    if (fieldType === "description") {
      return "e.g., buying textbooks, 200 kids, Dharavi, partner schools";
    }
    if (fieldType === "problem_statement") {
      return "e.g., kids lack notebooks, cannot study at night, dropping out";
    }
    if (fieldType === "expected_outcome") {
      return "e.g., regular school attendance, improved reading test scores by 30%";
    }
    return "e.g., procurement of medical kits, setup tents, hire 2 doctors";
  };

  return (
    <div className="inline-block relative">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 transition-colors cursor-pointer select-none"
        >
          {currentValue ? "✨ Regenerate" : "✨ Generate with AI"}
        </button>
      ) : (
        <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
      )}

      {isOpen && (
        <div className="absolute right-0 top-6 mt-1 w-80 p-4 bg-emerald-50 dark:bg-emerald-950/90 border border-emerald-100 dark:border-emerald-900/50 rounded-xl shadow-lg z-20 space-y-3 text-left">
          <div className="space-y-1">
            <h4 className="text-[11px] font-extrabold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
              AI Copywriting Assistant
            </h4>
            <label className="block text-[10px] text-gray-500 dark:text-gray-400">
              Give us a few quick points about this {fieldType === "milestone_description" ? "milestone" : "campaign"}:
            </label>
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={placeholderText()}
            rows={2}
            className="w-full p-2 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 dark:text-white focus:ring-1 focus:ring-emerald-500 focus:outline-none resize-none"
            autoFocus
          />

          {error && (
            <p className="text-[10px] text-red-600 dark:text-red-400 font-semibold leading-tight">
              ⚠️ {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setError("");
              }}
              className="px-2.5 py-1.5 border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-[10px] font-bold transition"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[10px] transition disabled:opacity-50 flex items-center gap-1 shadow-sm"
              disabled={loading}
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-1 h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                "Generate"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
