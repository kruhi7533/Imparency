import React from "react";

export default function PortfolioLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      {/* Hero Header Skeleton */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 py-12 px-4 sm:px-6 lg:px-8 animate-pulse">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-3">
            <div className="h-8 w-64 bg-gray-200 dark:bg-gray-800 rounded"></div>
            <div className="h-4 w-96 bg-gray-200 dark:bg-gray-800 rounded"></div>
          </div>
          <div className="flex gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-3 bg-gray-100 dark:bg-gray-800 rounded-2xl w-28 h-16"></div>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Column Skeleton */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 space-y-6 animate-pulse">
              <div className="space-y-2">
                <div className="h-5 w-40 bg-gray-200 dark:bg-gray-800 rounded"></div>
                <div className="h-3.5 w-64 bg-gray-200 dark:bg-gray-800 rounded"></div>
              </div>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 w-full bg-gray-100 dark:bg-gray-800/60 rounded-xl"></div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar Skeleton */}
          <div className="space-y-8">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 space-y-4 animate-pulse">
              <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-12 w-full bg-gray-100 dark:bg-gray-800 rounded-xl"></div>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 space-y-4 animate-pulse">
              <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-12 w-full bg-gray-100 dark:bg-gray-800 rounded-xl"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
