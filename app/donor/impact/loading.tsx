import React from "react";

export default function DonorImpactLoading() {
  return (
    <div className="font-sans">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-pulse space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-gray-200 rounded"></div>
          <div className="h-4 w-64 bg-gray-200 rounded"></div>
        </div>

        {/* Feed entries */}
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white border border-gray-200/80 rounded-2xl p-5 space-y-3">
            <div className="flex justify-between items-center">
              <div className="h-4 w-1/3 bg-gray-200 rounded"></div>
              <div className="h-3 w-16 bg-gray-200 rounded"></div>
            </div>
            <div className="h-3 w-full bg-gray-200 rounded"></div>
            <div className="h-3 w-3/4 bg-gray-200 rounded"></div>
          </div>
        ))}
      </main>
    </div>
  );
}
