"use client";

import React, { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminProjectReviewError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("Admin project review error caught:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col justify-center items-center px-4">
      <div className="bg-white border border-gray-200/80 rounded-2xl p-8 max-w-md w-full shadow-lg text-center space-y-6 animate-in fade-in duration-200">
        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner">
          ⚠️
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-gray-900">Project Review Error</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            An error occurred loading projects awaiting approval or the review audit trail.
          </p>
        </div>

        {error.message && (
          <div className="p-3 bg-gray-50 rounded-xl text-left text-[11px] font-mono text-gray-500 break-all select-all">
            {error.message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md transition"
          >
            Try Again
          </button>
          <Link
            href="/admin/dashboard"
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs border border-gray-200 transition text-center"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
