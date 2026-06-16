import React from "react";

export default function DiscoverLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      {/* Hero Section Skeleton */}
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 py-16 px-4 text-center animate-pulse">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="h-10 w-2/3 bg-gray-200 dark:bg-gray-800 rounded mx-auto"></div>
          <div className="h-4 w-1/2 bg-gray-200 dark:bg-gray-800 rounded mx-auto"></div>
          <div className="max-w-xl mx-auto h-12 bg-gray-100 dark:bg-gray-800/80 rounded-2xl"></div>
        </div>
        <div className="max-w-4xl mx-auto mt-10 flex items-center justify-center gap-2 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 w-24 bg-gray-200 dark:bg-gray-800 rounded-full"></div>
          ))}
        </div>
      </section>

      {/* Main Discover Layout Skeleton */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar Skeleton */}
          <aside className="space-y-6 hidden lg:block">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-2xl p-6 space-y-4 animate-pulse">
                <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-800 rounded"></div>
                <div className="h-8 w-full bg-gray-200 dark:bg-gray-800 rounded"></div>
              </div>
            ))}
          </aside>

          {/* Main Grid Skeleton */}
          <div className="lg:col-span-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 space-y-4 shadow-sm animate-pulse">
                  <div className="flex justify-between items-center">
                    <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-4 w-1/4 bg-gray-200 dark:bg-gray-800 rounded"></div>
                  </div>
                  <div className="h-6 w-3/4 bg-gray-200 dark:bg-gray-800 rounded"></div>
                  <div className="h-16 w-full bg-gray-100 dark:bg-gray-800 rounded"></div>
                  <div className="flex gap-2 pt-2">
                    <div className="h-4 w-12 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-4 w-12 bg-gray-200 dark:bg-gray-800 rounded"></div>
                  </div>
                  <div className="h-10 w-full bg-gray-250 dark:bg-gray-800 rounded-xl mt-4"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
