import React from "react";

export default function AdminProjectReviewLoading() {
  return (
    <div>
      {/* Navbar skeleton */}
      <nav className="bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center shadow-sm animate-pulse">
        <div className="flex items-center gap-2">
          <div className="h-6 w-32 bg-gray-200 rounded"></div>
          <div className="h-4 w-16 bg-gray-100 rounded-full"></div>
        </div>
        <div className="h-5 w-24 bg-gray-200 rounded"></div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6 animate-pulse">
        <div className="h-8 w-56 bg-gray-200 rounded"></div>

        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-gray-200/80 rounded-xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] overflow-hidden flex flex-col sm:flex-row"
          >
            <div className="h-40 w-full sm:w-56 bg-gray-100"></div>
            <div className="flex-1 p-5 space-y-3">
              <div className="h-5 w-1/2 bg-gray-200 rounded"></div>
              <div className="h-3 w-1/3 bg-gray-100 rounded"></div>
              <div className="h-3 w-full bg-gray-100 rounded"></div>
              <div className="h-3 w-5/6 bg-gray-100 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
