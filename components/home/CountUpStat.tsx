"use client";

import React, { useEffect, useRef } from "react";
import { motion, useInView, useMotionValue, useSpring, useTransform } from "framer-motion";
import { formatCompactINR } from "@/lib/format-currency";

interface CountUpStatProps {
  value: number;
  label: string;
  format?: "compact-inr" | "plain";
  suffix?: string;
  emptyLabel?: string;
  /** Gold numerals — reserved for rupee amounts (money is always gold). */
  accent?: boolean;
  /** Position in the strip — staggers the reveal. */
  index?: number;
}

function formatValue(n: number, format: CountUpStatProps["format"], suffix?: string) {
  const base = format === "compact-inr" ? formatCompactINR(n) : Math.round(n).toLocaleString("en-IN");
  return suffix ? `${base}${suffix}` : base;
}

export default function CountUpStat({ value, label, format = "plain", suffix, emptyLabel, accent, index = 0 }: CountUpStatProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 90, damping: 20, restDelta: 0.5 });
  // Formatting happens on the motion value itself — the count-up never
  // touches React state, so there are zero re-renders during the animation.
  const display = useTransform(spring, (v) => formatValue(v, format, suffix));

  useEffect(() => {
    if (inView && value > 0) {
      motionValue.set(value);
    }
  }, [inView, value, motionValue]);

  const showEmpty = value === 0 && emptyLabel;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      transition={{ duration: 0.35, ease: "easeOut", delay: index * 0.08 }}
      className="border-t border-gray-700 pt-6 text-center"
    >
      {showEmpty ? (
        <div className="text-lg font-semibold text-gray-300 leading-[3.75rem]">{emptyLabel}</div>
      ) : (
        <motion.div className={`font-mono text-5xl sm:text-6xl font-semibold tabular-nums leading-none ${accent ? "text-gold-300" : "text-white"}`}>
          {display}
        </motion.div>
      )}
      <div className="font-mono text-[11px] text-gray-400 mt-4 uppercase tracking-widest">{label}</div>
    </motion.div>
  );
}
