"use client";

import React, { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DiscoverError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("Discover page error caught:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col justify-center items-center px-4 font-sans transition-colors duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-8 max-w-md w-full shadow-lg text-center space-y-6 animate-in fade-in duration-200">
        <div className="w-16 h-16 bg-red-50 dark:bg-red-950/20 text-red-650 dark:text-red-400 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner">
          ⚠️
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-black text-gray-900 dark:text-white">Failed to load discover list</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            An unexpected error occurred while querying the non-profit search engine. Please try resetting your search parameters.
          </p>
        </div>

        {error.message && (
          <div className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl text-left text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all select-all">
            {error.message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md transition"
          >
            Reset & Retry
          </button>
          <Link
            href="/"
            className="flex-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold py-2.5 rounded-xl text-xs border border-gray-200 dark:border-gray-700 transition text-center"
          >
            Go to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
