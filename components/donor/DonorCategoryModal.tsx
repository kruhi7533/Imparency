"use client";

import React, { useState } from "react";

interface DonorCategoryModalProps {
  isOpen: boolean;
  onComplete: (category: string) => void;
  onClose: () => void;
}

export function DonorCategoryModal({
  isOpen,
  onComplete,
  onClose,
}: DonorCategoryModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!selectedCategory) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/user/donor-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ donorCategory: selectedCategory }),
      });
      if (!res.ok) throw new Error("Failed to save");
      onComplete(selectedCategory); // pass category back to parent
    } catch (err) {
      console.error(err);
      // Don't block — let the parent handle error
      onComplete(selectedCategory);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center animate-fadeIn">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full mx-4 p-6 shadow-2xl relative">
        <div className="space-y-6">

          {/* Header */}
          <div>
            <h2 className="text-lg font-black text-white">
              One quick question before you donate
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Under Indian law (FCRA), we need to know your residency
              status to ensure your donation is processed correctly.
              You only need to answer this once.
            </p>
          </div>

          {/* Category options — 3 cards */}
          <div className="space-y-3">
            {[
              {
                value: "INDIAN_RESIDENT",
                label: "Indian Resident",
                description: "Indian citizen currently living and donating from India",
                icon: "🇮🇳",
              },
              {
                value: "NRI_OCI",
                label: "NRI / OCI",
                description: "Non-Resident Indian or Overseas Citizen of India",
                icon: "✈️",
              },
              {
                value: "FOREIGN_NATIONAL",
                label: "Foreign National",
                description: "Citizen of a country other than India",
                icon: "🌍",
              },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedCategory(option.value)}
                className={`
                  w-full flex items-center gap-4 p-4 rounded-xl border-2
                  text-left transition-all duration-150 cursor-pointer
                  ${selectedCategory === option.value
                    ? "border-emerald-500 bg-emerald-950/30 text-white"
                    : "border-gray-800 bg-gray-900/50 text-gray-400 hover:border-gray-700 hover:text-white"
                  }
                `}
              >
                <span className="text-2xl">{option.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-bold leading-none">
                    {option.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 leading-snug">
                    {option.description}
                  </div>
                </div>
                {selectedCategory === option.value && (
                  <span className="ml-auto text-emerald-400 shrink-0">
                    {/* Checkmark SVG — 20x20 */}
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z"
                        clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Legal note */}
          <p className="text-[10px] text-gray-600 leading-relaxed">
            This information is required under the Foreign Contribution
            (Regulation) Act, 2010. It is stored securely and used only
            to determine donation eligibility.
          </p>

          {/* Confirm button */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedCategory || isSaving}
            className={`
              w-full py-3 rounded-xl text-sm font-extrabold transition-all cursor-pointer
              ${selectedCategory && !isSaving
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-gray-800 text-gray-600 cursor-not-allowed"
              }
            `}
          >
            {isSaving ? "Saving..." : "Confirm & Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
