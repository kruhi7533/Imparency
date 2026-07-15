"use client";

import React, { useRef } from "react";
import { motion, useInView } from "framer-motion";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

/**
 * Masked line-reveal: content slides up from behind an overflow-hidden
 * clip when scrolled into view. The signature "editorial" entrance.
 *
 * The in-view observer watches the OUTER mask, not the animated child —
 * the child starts fully clipped (zero visible area), so observing it
 * directly would never fire and the content would stay hidden forever.
 */
export default function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    // pb-[0.15em] gives descenders (y, p, g) and italic swashes room to
    // clear the mask instead of getting clipped. No compensating negative
    // margin — that would cancel the extra space and pull lines back
    // together, which is what caused the overlap this replaced.
    <span ref={ref} className={`block overflow-hidden pb-[0.15em] ${className ?? ""}`}>
      <motion.span
        className="block"
        initial={{ y: "110%" }}
        animate={inView ? { y: 0 } : {}}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay }}
      >
        {children}
      </motion.span>
    </span>
  );
}
