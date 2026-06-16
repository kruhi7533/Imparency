import React from "react";

export default function NGOProfileLoading() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 font-sans transition-colors duration-200">
      {/* Banner / Header */}
      <div className="h-64 w-full bg-gradient-to-r from-emerald-600 to-teal-500 relative">
        <div className="absolute inset-0 bg-black/10"></div>
      </div>

      {/* Profile Info Details Card */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 pb-16 relative z-10">
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 sm:p-8 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6 animate-pulse">
          <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center">
            <div className="w-24 h-24 bg-gray-200 dark:bg-gray-800 rounded-2xl border-4 border-white dark:border-gray-900 shadow-md"></div>
            <div className="space-y-3">
              <div className="h-7 w-48 bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="flex gap-2">
                <div className="h-4 w-12 bg-gray-100 dark:bg-gray-800 rounded"></div>
                <div className="h-4 w-12 bg-gray-100 dark:bg-gray-800 rounded"></div>
              </div>
            </div>
          </div>
          <div className="w-full sm:w-auto h-12 bg-gray-200 dark:bg-gray-800 rounded-xl px-12"></div>
        </div>

        {/* Stats and Health Score Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          {/* Main Info Columns */}
          <div className="lg:col-span-2 space-y-8">
            {/* Tabs List */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-4 shadow-sm flex gap-2 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 w-24 bg-gray-200 dark:bg-gray-800 rounded-xl"></div>
              ))}
            </div>

            {/* Tab Contents Skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 animate-pulse">
              {[1, 2].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                  <div className="h-40 bg-gray-200 dark:bg-gray-800"></div>
                  <div className="p-5 space-y-3">
                    <div className="h-3 w-16 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-10 w-full bg-gray-100 dark:bg-gray-800 rounded"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Metrics Sidebar Skeleton */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm animate-pulse space-y-6">
              <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded"></div>
              <div className="text-center py-6 border-b border-gray-100 dark:border-gray-800 flex flex-col items-center">
                <div className="h-12 w-20 bg-gray-200 dark:bg-gray-800 rounded mb-2"></div>
                <div className="h-3 w-28 bg-gray-100 dark:bg-gray-800 rounded"></div>
              </div>
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-800 rounded"></div>
                    <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
