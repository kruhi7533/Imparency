"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Buttery wheel-glide scrolling for the landing page (agency-style feel).
 * Renders nothing — mounting it activates Lenis on the document, unmounting
 * (navigating away) restores native scrolling. Skipped entirely for users
 * who prefer reduced motion.
 */
export default function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ lerp: 0.12 });
    let rafId: number;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return null;
}
