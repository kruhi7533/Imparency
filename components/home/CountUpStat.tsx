"use client";

import React, { useEffect, useRef } from "react";
import { motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { formatCompactINR } from "@/lib/format-currency";

interface CountUpStatProps {
  value: number;
  label: string;
  format?: "compact-inr" | "plain";
  suffix?: string;
  emptyLabel?: string;
  /** Emphasised numerals — reserved for rupee amounts. */
  accent?: boolean;
  /** Optional icon/visual rendered beside the figure (server-rendered node). */
  icon?: React.ReactNode;
  /** Position in the strip — staggers the reveal. */
  index?: number;
}

function formatValue(n: number, format: CountUpStatProps["format"], suffix?: string) {
  // Round every animation frame: a spring passes through fractions, and
  // "₹30,058.072" mid-count reads as a wrong figure.
  const base = format === "compact-inr" ? formatCompactINR(Math.round(n)) : Math.round(n).toLocaleString("en-IN");
  return suffix ? `${base}${suffix}` : base;
}

export default function CountUpStat({ value, label, format = "plain", suffix, emptyLabel, accent, icon, index = 0 }: CountUpStatProps) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 20, restDelta: 0.5 });
  // Formatting happens on the motion value itself — the count-up never
  // touches React state, so there are zero re-renders during the animation.
  const display = useTransform(spring, (v) => formatValue(v, format, suffix));

  useEffect(() => {
    if (inView && value > 0) {
      // Reduced motion: land on the real figure immediately, no count-up.
      if (reduceMotion) spring.jump(value);
      motionValue.set(value);
    }
  }, [inView, value, motionValue, spring, reduceMotion]);

  const showEmpty = value === 0 && emptyLabel;

  return (
    <motion.div
      ref={ref}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, ease: "easeOut", delay: index * 0.08 }}
      className="flex items-center gap-4"
    >
      {icon}
      <div className="min-w-0">
        {showEmpty ? (
          <div className="text-base font-semibold text-gray-700 leading-8">{emptyLabel}</div>
        ) : (
          <motion.div
            className={`text-2xl sm:text-[1.75rem] font-semibold tabular-nums leading-8 tracking-tight ${
              accent ? "text-emerald-700" : "text-gray-900"
            }`}
          >
            {display}
          </motion.div>
        )}
        <div className="text-sm text-gray-500 mt-0.5">{label}</div>
      </div>
    </motion.div>
  );
}
