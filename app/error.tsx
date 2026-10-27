"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("Root error caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center px-4 font-sans">
      <div className="bg-white border border-gray-200/80 rounded-2xl p-8 max-w-md w-full shadow-[0_8px_30px_rgba(16,24,40,0.06)] text-center space-y-6">
        <div className="w-14 h-14 bg-red-50 text-red-600 ring-1 ring-red-100 rounded-full flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" strokeWidth={1.75} aria-hidden />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-semibold text-gray-900">Something went wrong!</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            An unexpected error occurred while rendering this page. If this persists, please contact support or return to the main lobby.
          </p>
        </div>

        {error.message && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-left text-[11px] font-mono text-gray-600 break-all select-all">
            {error.message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex-1 bg-trust-600 hover:bg-trust-700 text-white font-semibold py-2 rounded-lg text-sm transition"
          >
            Retry Loading
          </button>
          <Link
            href="/"
            className="flex-1 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-2 rounded-lg text-sm border border-gray-300 transition text-center"
          >
            Go to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
