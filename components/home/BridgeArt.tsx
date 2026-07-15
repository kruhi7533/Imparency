"use client";

import React, { useRef } from "react";
import { motion, useInView } from "framer-motion";

/**
 * The ImpactBridge, drawn as living line-art: a donor's rupee on the left
 * shore, sequential milestone checkpoints along the deck, and a sprout on
 * the far shore. The bridge draws itself on scroll — deliberately an
 * illustration (not a photo, not AI imagery): an honest diagram of how
 * money actually crosses this platform.
 */
export default function BridgeArt() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const draw = (delay: number) => ({
    initial: { pathLength: 0, opacity: 0 },
    animate: inView ? { pathLength: 1, opacity: 1 } : {},
    transition: { duration: 1.1, ease: "easeInOut" as const, delay },
  });

  const pop = (delay: number) => ({
    initial: { scale: 0, opacity: 0 },
    animate: inView ? { scale: 1, opacity: 1 } : {},
    transition: { type: "spring" as const, stiffness: 260, damping: 18, delay },
  });

  return (
    <svg
      ref={ref}
      viewBox="0 0 900 270"
      fill="none"
      className="w-full max-w-4xl mx-auto"
      role="img"
      aria-label="Illustration: a donation crosses a bridge of verified milestones to become real-world impact"
    >
      {/* Water — faint dashes under the bridge */}
      <motion.path d="M20 245 H880" stroke="#374151" strokeDasharray="2 10" strokeWidth="1.5" {...draw(1.4)} />

      {/* Deck */}
      <motion.path d="M40 200 H860" stroke="#4b5563" strokeWidth="2" {...draw(0)} />

      {/* Pylons */}
      <motion.path d="M250 200 V70 M243 70 H257" stroke="#4b5563" strokeWidth="2.5" {...draw(0.35)} />
      <motion.path d="M650 200 V70 M643 70 H657" stroke="#4b5563" strokeWidth="2.5" {...draw(0.35)} />

      {/* Suspension cables */}
      <motion.path
        d="M40 200 C120 92 200 72 250 70 C350 158 550 158 650 70 C700 72 780 92 860 200"
        stroke="#8ea9e0"
        strokeOpacity="0.65"
        strokeWidth="1.75"
        {...draw(0.55)}
      />

      {/* Hangers between the pylons */}
      <motion.path d="M330 118 V200" stroke="#8ea9e0" strokeOpacity="0.3" strokeWidth="1.25" {...draw(1)} />
      <motion.path d="M400 133 V200" stroke="#8ea9e0" strokeOpacity="0.3" strokeWidth="1.25" {...draw(1.05)} />
      <motion.path d="M450 137 V200" stroke="#8ea9e0" strokeOpacity="0.3" strokeWidth="1.25" {...draw(1.1)} />
      <motion.path d="M500 133 V200" stroke="#8ea9e0" strokeOpacity="0.3" strokeWidth="1.25" {...draw(1.15)} />
      <motion.path d="M570 118 V200" stroke="#8ea9e0" strokeOpacity="0.3" strokeWidth="1.25" {...draw(1.2)} />

      {/* The donor's rupee — left shore */}
      <motion.g {...pop(1.5)} style={{ transformOrigin: "70px 168px" }}>
        <circle cx="70" cy="168" r="17" fill="#0a1120" stroke="#e3a730" strokeWidth="1.75" />
        <text x="70" y="174" textAnchor="middle" fill="#edc158" fontSize="16" fontFamily="var(--font-mono)">
          ₹
        </text>
      </motion.g>

      {/* Milestone checkpoints along the deck */}
      {[
        { x: 290, label: "01", delay: 1.7 },
        { x: 450, label: "02", delay: 1.85 },
        { x: 610, label: "03", delay: 2.0 },
      ].map((m) => (
        <motion.g key={m.label} {...pop(m.delay)} style={{ transformOrigin: `${m.x}px 200px` }}>
          <circle cx={m.x} cy="200" r="12" fill="#0a1120" stroke="#5f83cf" strokeWidth="1.5" />
          <text x={m.x} y="204" textAnchor="middle" fill="#8ea9e0" fontSize="9" fontFamily="var(--font-mono)">
            {m.label}
          </text>
        </motion.g>
      ))}

      {/* Verification check — the last gate before impact */}
      <motion.g {...pop(2.2)} style={{ transformOrigin: "750px 200px" }}>
        <circle cx="750" cy="200" r="12" fill="#0a1120" stroke="#34d399" strokeWidth="1.5" />
        <path d="M744.5 200 l4 4 l7 -8" stroke="#34d399" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </motion.g>

      {/* The sprout — far shore, what the rupee becomes */}
      <motion.g {...pop(2.45)} style={{ transformOrigin: "838px 185px" }}>
        <path d="M838 196 V172" stroke="#34d399" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M838 180 C830 178 825 170 826 162 C834 163 839 170 838 180" fill="none" stroke="#34d399" strokeWidth="1.6" />
        <path d="M838 174 C846 172 851 164 850 156 C842 157 837 164 838 174" fill="none" stroke="#34d399" strokeWidth="1.6" />
      </motion.g>

      {/* Journey labels — receipt voice */}
      <motion.g {...pop(2.6)}>
        <text x="70" y="230" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="2">
          YOUR GIFT
        </text>
        <text x="450" y="230" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="2">
          VERIFIED MILESTONES
        </text>
        <text x="838" y="230" textAnchor="middle" fill="#9ca3af" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="2">
          REAL IMPACT
        </text>
      </motion.g>
    </svg>
  );
}
