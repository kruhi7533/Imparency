"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { formatCompactINR } from "@/lib/format-currency";

/**
 * A KPI number that counts up once on mount. The final value is rendered on the
 * server (so it is in the HTML and readable without JS); motion only replays it
 * from zero, and not at all under prefers-reduced-motion.
 */
export default function CountUp({ value, format = "plain", suffix = "" }: { value: number; format?: "inr" | "plain"; suffix?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduce || value <= 0) return;
    const duration = 900;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setShown(value);
    };
  }, [value, reduce]);

  const n = shown >= value ? value : shown;
  const text = format === "inr" ? formatCompactINR(Math.round(n)) : Math.round(n).toLocaleString("en-IN");
  const final = `${format === "inr" ? formatCompactINR(value) : value.toLocaleString("en-IN")}${suffix}`;
  return (
    <span className="tabular-nums">
      <span className="sr-only">{final}</span>
      <span aria-hidden>
        {text}
        {suffix}
      </span>
    </span>
  );
}
