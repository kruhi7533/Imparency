"use client";

import React, { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function NGOProfileError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("NGO profile page error caught:", error);
  }, [error]);

  return (
    <div className="min-h-[70vh] flex flex-col justify-center items-center px-4 py-16 font-sans">
      <div className="bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800 rounded-2xl p-8 max-w-md w-full shadow-[0_1px_2px_rgba(16,24,40,0.04)] text-center space-y-6 animate-in fade-in duration-200">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-950/20 text-red-600 ring-1 ring-red-200 rounded-full flex items-center justify-center text-3xl mx-auto">
          ⚠️
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-xl font-semibold text-gray-900">Failed to load NGO profile</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            An error occurred retrieving details, projects, or health scores for this non-profit. It may have been suspended or deleted.
          </p>
        </div>

        {error.message && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-left text-[11px] font-mono text-gray-600 break-all select-all">
            {error.message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex-1 bg-trust-600 hover:bg-trust-700 text-white font-semibold py-2.5 rounded-lg text-xs shadow-sm transition"
          >
            Retry Loading
          </button>
          <Link
            href="/discover"
            className="flex-1 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-2.5 rounded-lg text-xs border border-gray-300 transition text-center"
          >
            Browse NGOs
          </Link>
        </div>
      </div>
    </div>
  );
}
