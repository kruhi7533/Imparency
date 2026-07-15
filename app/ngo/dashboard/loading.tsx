import React from "react";

export default function NGODashboardLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-pulse space-y-8">
        {/* Header row */}
        <div className="flex justify-between items-center">
          <div className="space-y-2">
            <div className="h-7 w-56 bg-gray-200 dark:bg-gray-800 rounded"></div>
            <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded"></div>
          </div>
          <div className="h-10 w-36 bg-gray-200 dark:bg-gray-800 rounded-lg"></div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5 space-y-2">
              <div className="h-3 w-1/2 bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="h-7 w-2/3 bg-gray-200 dark:bg-gray-800 rounded"></div>
            </div>
          ))}
        </div>

        {/* Project cards */}
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div className="h-5 w-1/3 bg-gray-200 dark:bg-gray-800 rounded"></div>
                <div className="h-5 w-20 bg-gray-200 dark:bg-gray-800 rounded-full"></div>
              </div>
              <div className="h-3 w-full bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="h-3 w-2/3 bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="h-2.5 w-full bg-gray-100 dark:bg-gray-800/70 rounded-full"></div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
