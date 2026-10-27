"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, HandHeart, HeartHandshake, TrendingUp } from "lucide-react";

interface HeroVisualProps {
  /** A real project cover photo; null renders a designed fallback. */
  image: { src: string; alt: string } | null;
  /** The most recent successful donation — hidden when there is none. */
  latestDonation: { amount: number; projectTitle: string } | null;
  /** Approved-on-time milestone share — null when the sample is too small. */
  onTimePct: number | null;
  approvedCount: number;
  /** Milestones verified so far; shown instead of the share when that is null. */
  verifiedMilestones: number;
}

/**
 * The hero's right column: a real campaign photo inside an organic blob, with
 * two floating cards that only ever show figures read from the database.
 * The float is a slow 6s drift and switches off under prefers-reduced-motion.
 */
export default function HeroVisual({ image, latestDonation, onTimePct, approvedCount, verifiedMilestones }: HeroVisualProps) {
  const reduceMotion = useReducedMotion();
  const [broken, setBroken] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // Catch a load failure that happened before hydration attached onError.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setBroken(true);
  }, [image?.src]);
  const showPhoto = image && !broken;

  const float = (delay: number) =>
    reduceMotion
      ? {}
      : {
          animate: { y: [0, -8, 0] },
          transition: { duration: 6, ease: "easeInOut" as const, repeat: Infinity, delay },
        };

  return (
    <div className="relative mx-auto w-full max-w-[560px] pb-4 sm:pb-12">
      {/* Organic mask, in objectBoundingBox units so it scales with the box */}
      <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
        <defs>
          <clipPath id="hero-blob" clipPathUnits="objectBoundingBox">
            <path d="M0.53,0.02 C0.70,-0.01,0.88,0.06,0.95,0.22 C1.02,0.38,0.98,0.55,0.96,0.70 C0.93,0.86,0.80,0.97,0.62,0.99 C0.44,1.01,0.26,0.97,0.14,0.86 C0.02,0.75,-0.01,0.58,0.01,0.42 C0.03,0.26,0.12,0.12,0.27,0.06 C0.36,0.03,0.44,0.03,0.53,0.02 Z" />
          </clipPath>
        </defs>
      </svg>

      {/* Soft tinted shape behind the photo */}
      <div
        aria-hidden
        className="absolute inset-0 translate-x-3 translate-y-3 sm:translate-x-5 sm:translate-y-4 bg-trust-100/70"
        style={{ clipPath: "url(#hero-blob)" }}
      />

      <div className="relative aspect-[1/1] sm:aspect-[6/5] w-full overflow-hidden" style={{ clipPath: "url(#hero-blob)" }}>
        {showPhoto ? (
          // Plain <img>: cover images are remote (Cloudinary/Unsplash) and the
          // app has no next/image remote config.
          <img
            ref={imgRef}
            src={image.src}
            alt={image.alt}
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-trust-100 via-trust-50 to-emerald-50">
            <HandHeart className="h-24 w-24 text-trust-400" strokeWidth={1.25} aria-hidden />
            <span className="sr-only">Campaign photos appear here once projects are live</span>
          </div>
        )}
      </div>

      {latestDonation && (
        <motion.div
          {...float(0)}
          className="absolute left-0 top-[8%] sm:-left-6 lg:-left-10 flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white/95 px-4 py-3 shadow-lg shadow-gray-900/[0.06] max-w-[240px]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50">
            <HeartHandshake className="h-5 w-5 text-rose-600" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-semibold leading-tight text-gray-900 tabular-nums">
              ₹{latestDonation.amount.toLocaleString("en-IN")}
            </span>
            <span className="block text-[11px] font-medium text-gray-500">Last verified donation</span>
            <span className="block truncate text-[11px] text-gray-700">{latestDonation.projectTitle}</span>
          </span>
        </motion.div>
      )}

      {(onTimePct !== null || verifiedMilestones > 0) && (
        <motion.div
          {...float(1.5)}
          className="absolute right-0 bottom-[14%] sm:-right-4 lg:-right-8 flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white/95 px-4 py-3 shadow-lg shadow-gray-900/[0.06]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50">
            {onTimePct !== null ? (
              <TrendingUp className="h-5 w-5 text-emerald-600" aria-hidden />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
            )}
          </span>
          <span>
            {onTimePct !== null ? (
              <>
                <span className="block text-lg font-semibold leading-tight text-gray-900 tabular-nums">{onTimePct}%</span>
                <span className="block text-[11px] font-medium text-gray-500">Milestones verified on time</span>
                <span className="block text-[11px] text-gray-500">of {approvedCount.toLocaleString("en-IN")} approved</span>
              </>
            ) : (
              <>
                <span className="block text-lg font-semibold leading-tight text-gray-900 tabular-nums">
                  {verifiedMilestones.toLocaleString("en-IN")}
                </span>
                <span className="block text-[11px] font-medium text-gray-500">Milestones verified</span>
                <span className="block text-[11px] text-gray-500">proof checked before funds move</span>
              </>
            )}
          </span>
        </motion.div>
      )}

      {/* Handwritten-style caption with a drawn arrow */}
      <div className="absolute bottom-0 left-[6%] hidden sm:flex items-end gap-1.5 text-trust-700" aria-hidden>
        <svg width="44" height="30" viewBox="0 0 44 30" fill="none" className="mb-2 -scale-y-100">
          <path d="M40 4 C30 4 16 8 8 22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5 15 L8 23 L15 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-display italic text-lg -rotate-3">Real people. Real progress.</span>
      </div>
    </div>
  );
}
