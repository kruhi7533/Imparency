"use client";

import React from "react";

/**
 * Infinite horizontal marquee of verified NGO names — the platform's
 * "partners strip". Real organizations from the database, not logos of
 * companies we wish were partners. Pauses on hover.
 */
export default function NgoMarquee({ names }: { names: string[] }) {
  if (names.length === 0) return null;

  // The track holds two identical halves; the keyframe slides -50% for a
  // seamless loop. Short lists are repeated so each half fills the viewport.
  const repeats = Math.max(1, Math.ceil(8 / names.length));
  const half = Array.from({ length: repeats }, () => names).flat();

  return (
    <div className="relative overflow-hidden py-8 border-y border-gray-800 group" aria-label="Verified NGOs on ImpactBridge">
      {/* Edge fades */}
      <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-gray-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-gray-950 to-transparent z-10 pointer-events-none" />

      <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused]">
        {[0, 1].map((halfIdx) => (
          <div key={halfIdx} className="flex shrink-0 items-center" aria-hidden={halfIdx === 1}>
            {half.map((name, i) => (
              <span key={`${halfIdx}-${i}`} className="flex items-center shrink-0">
                <span className="font-display text-xl sm:text-2xl font-medium text-gray-400 whitespace-nowrap px-8">
                  {name}
                </span>
                <span className="text-gold-400 text-lg select-none" aria-hidden>
                  ·
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
