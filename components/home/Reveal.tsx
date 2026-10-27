"use client";

import React, { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /**
   * "mask" (default): masked line-reveal for headline text — slides up from
   * behind an overflow-hidden clip. "fade": a gentle fade/slide-up with no
   * clipping, for blocks with buttons, shadows or focus rings.
   */
  variant?: "mask" | "fade";
  /** Wrapper element. Use "div" for block content outside headings. */
  as?: "span" | "div";
}

/**
 * Scroll-triggered entrance. Under prefers-reduced-motion the content renders
 * in place with no movement at all.
 *
 * The in-view observer watches the OUTER wrapper, not the animated child —
 * in "mask" mode the child starts fully clipped (zero visible area), so
 * observing it directly would never fire and the content would stay hidden.
 */
export default function Reveal({ children, className, delay = 0, variant = "mask", as = "span" }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduceMotion = useReducedMotion();
  const Wrapper = as as React.ElementType;
  const Inner = as === "div" ? motion.div : motion.span;

  if (reduceMotion) {
    return (
      <Wrapper ref={ref} className={`block ${className ?? ""}`}>
        {children}
      </Wrapper>
    );
  }

  if (variant === "fade") {
    return (
      <Wrapper ref={ref} className={`block ${className ?? ""}`}>
        <Inner
          className="block"
          initial={{ opacity: 0, y: 14 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
        >
          {children}
        </Inner>
      </Wrapper>
    );
  }

  return (
    // pb-[0.15em] gives descenders (y, p, g) and italic swashes room to
    // clear the mask instead of getting clipped.
    <Wrapper ref={ref} className={`block overflow-hidden pb-[0.15em] ${className ?? ""}`}>
      <Inner
        className="block"
        initial={{ y: "110%" }}
        animate={inView ? { y: 0 } : {}}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay }}
      >
        {children}
      </Inner>
    </Wrapper>
  );
}
