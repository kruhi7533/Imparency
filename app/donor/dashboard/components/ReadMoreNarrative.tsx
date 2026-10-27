"use client";

import React, { useState } from "react";

interface ReadMoreNarrativeProps {
  narrative: string;
  limit?: number;
}

export default function ReadMoreNarrative({ narrative, limit = 150 }: ReadMoreNarrativeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const shouldTruncate = narrative.length > limit;
  const displayText = isExpanded ? narrative : shouldTruncate ? `${narrative.slice(0, limit)}...` : narrative;

  return (
    <div className="space-y-2">
      <p className="text-xs sm:text-sm text-gray-600 leading-relaxed font-normal whitespace-pre-wrap">
        {displayText}
      </p>
      {shouldTruncate && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs font-bold text-trust-700 hover:text-trust-800 transition-colors inline-flex items-center gap-1 focus:outline-none"
        >
          {isExpanded ? (
            <>
              Show less
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
              </svg>
            </>
          ) : (
            <>
              Read more
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </button>
      )}
    </div>
  );
}
