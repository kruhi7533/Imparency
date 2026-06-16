import React from "react";

export default function AdminDashboardLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      {/* Top Navbar Skeleton */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex justify-between items-center shadow-sm animate-pulse">
        <div className="flex items-center gap-2">
          <div className="h-6 w-32 bg-gray-200 dark:bg-gray-800 rounded"></div>
          <div className="h-4.5 w-16 bg-gray-100 dark:bg-gray-800 rounded-full"></div>
        </div>
        <div className="h-5 w-24 bg-gray-200 dark:bg-gray-800 rounded"></div>
      </nav>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8 animate-pulse">
        {/* Page Title */}
        <div className="h-8 w-48 bg-gray-250 dark:bg-gray-800 rounded"></div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-3 w-24 bg-gray-200 dark:bg-gray-800 rounded"></div>
                <div className="h-8 w-16 bg-gray-200 dark:bg-gray-800 rounded"></div>
              </div>
              <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full"></div>
            </div>
          ))}
        </div>

        {/* Big Chart Loader */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm h-64 flex flex-col justify-between">
          <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded"></div>
          <div className="h-44 w-full bg-gray-100 dark:bg-gray-850 rounded-lg"></div>
        </div>

        {/* Tab & Table Skeletons */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="h-5 w-32 bg-gray-200 dark:bg-gray-800 rounded"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 w-full bg-gray-100 dark:bg-gray-800 rounded-xl"></div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
