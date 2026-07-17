"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";

/**
 * Impact stories, told in the same living line-art voice as BridgeArt:
 * hand-drawn scenes that ink themselves in and cycle — a girl's first day
 * of school, her education, care reaching a village, and the country all
 * of it compounds into. Deliberately illustration, not stock photography:
 * the gold in every scene is the donor's rupee, arrived.
 */

type Stroke = {
  d: string;
  stroke: string;
  width?: number;
  opacity?: number;
  dash?: string;
};

type Dot = { cx: number; cy: number; r: number; stroke: string; width?: number };

type Scene = {
  id: string;
  kicker: string;
  title: string;
  body: string;
  paths: Stroke[];
  circles?: Dot[];
};

// Palette shared with BridgeArt: structure gray, trust-200 figures,
// gold for the funded thing, emerald for growth.
const GRAY = "#4b5563";
const TRUST = "#8ea9e0";
const GOLD = "#e3a730";
const GOLD_SOFT = "#edc158";
const GREEN = "#34d399";

const SCENES: Scene[] = [
  {
    id: "first-day",
    kicker: "Education · Day one",
    title: "Meera's first day of school",
    body:
      "One verified school-kit milestone puts a child at a desk — uniform, books, a gold backpack that a donor can trace. Attendance is where a nation begins.",
    paths: [
      // ground
      { d: "M20 240 H440", stroke: GRAY, width: 2 },
      // school building
      { d: "M300 240 V160 H420 V240", stroke: GRAY, width: 2 },
      { d: "M290 160 L360 118 L430 160", stroke: TRUST, width: 2 },
      { d: "M345 240 V196 H375 V240", stroke: GRAY, width: 1.5 },
      { d: "M310 180 H330 V200 H310 Z", stroke: TRUST, width: 1.25, opacity: 0.5 },
      // flag over the school
      { d: "M360 118 V88", stroke: GRAY, width: 1.5 },
      { d: "M360 88 H382 V100 H360", stroke: GOLD, width: 1.5 },
      // sun
      { d: "M46 46 l-8 -8 M94 46 l8 -8 M70 34 v-12 M46 94 l-8 8 M94 94 l8 8", stroke: GOLD, width: 1.5, opacity: 0.7 },
      // Meera, mid-stride
      { d: "M170 167 V205", stroke: TRUST, width: 1.75 },
      { d: "M170 178 L154 192 M170 178 L186 190", stroke: TRUST, width: 1.75 },
      { d: "M170 205 L156 238 M170 205 L186 238", stroke: TRUST, width: 1.75 },
      // the gold backpack — the funded school kit
      { d: "M176 172 H190 V192 H176 Z", stroke: GOLD, width: 1.5 },
      // her path to the door
      { d: "M200 232 H340", stroke: GOLD_SOFT, width: 1.25, opacity: 0.5, dash: "3 8" },
    ],
    circles: [
      { cx: 70, cy: 70, r: 18, stroke: GOLD, width: 1.75 },
      { cx: 170, cy: 158, r: 9, stroke: TRUST, width: 1.75 },
    ],
  },
  {
    id: "girl-education",
    kicker: "Girl education",
    title: "She stays, she learns, she leads",
    body:
      "Every funded term is proof-checked before the next releases. A girl who finishes school lifts her whole family with her — that's not charity, that's compounding.",
    paths: [
      // desk
      { d: "M60 210 H400", stroke: GRAY, width: 2 },
      // open book
      { d: "M230 150 C200 138 170 138 150 146 V196 C170 188 200 188 230 200", stroke: TRUST, width: 1.75 },
      { d: "M230 150 C260 138 290 138 310 146 V196 C290 188 260 188 230 200", stroke: TRUST, width: 1.75 },
      { d: "M230 150 V200", stroke: TRUST, width: 1.5 },
      { d: "M165 158 C185 152 205 152 222 158", stroke: TRUST, width: 1, opacity: 0.4 },
      { d: "M238 158 C255 152 275 152 295 158", stroke: TRUST, width: 1, opacity: 0.4 },
      // study lamp
      { d: "M110 210 V150", stroke: GRAY, width: 1.75 },
      { d: "M96 150 H124 L117 132 H103 Z", stroke: GRAY, width: 1.5 },
      { d: "M110 156 V182", stroke: GOLD_SOFT, width: 1.25, opacity: 0.5, dash: "2 6" },
      // the graduation cap rising off the page
      { d: "M230 96 L268 108 L230 120 L192 108 Z", stroke: GOLD, width: 1.75 },
      { d: "M268 108 V126", stroke: GOLD, width: 1.25 },
      // sparks of what she'll become
      { d: "M330 110 v10 M325 115 h10", stroke: GOLD_SOFT, width: 1.25, opacity: 0.7 },
      { d: "M356 140 v8 M352 144 h8", stroke: GOLD_SOFT, width: 1.25, opacity: 0.5 },
    ],
    circles: [{ cx: 268, cy: 130, r: 2.5, stroke: GOLD, width: 1.25 }],
  },
  {
    id: "care",
    kicker: "Healthcare",
    title: "Care reaches the last village",
    body:
      "Mobile clinics roll out milestone by milestone, receipt by receipt. The pulse you fund in a city browser beats in a village that never had a doctor.",
    paths: [
      // road
      { d: "M20 236 H440", stroke: GRAY, width: 2 },
      // clinic van
      { d: "M120 226 V186 H250 V226", stroke: TRUST, width: 1.75 },
      { d: "M250 226 V196 H292 L306 214 V226", stroke: TRUST, width: 1.75 },
      // the gold cross — the funded clinic
      { d: "M185 196 v20 M175 206 h20", stroke: GOLD, width: 2.5 },
      // motion lines
      { d: "M96 196 h-24 M100 212 h-32", stroke: TRUST, width: 1.25, opacity: 0.4, dash: "4 6" },
      // village huts ahead
      { d: "M350 226 V196 L375 178 L400 196 V226", stroke: GRAY, width: 1.75 },
      { d: "M405 226 V204 L422 192 L438 204 V226", stroke: GRAY, width: 1.5 },
      // the pulse over the village
      { d: "M330 150 h20 l8 -14 l10 26 l8 -12 h22", stroke: GREEN, width: 1.75 },
    ],
    circles: [
      { cx: 150, cy: 226, r: 10, stroke: TRUST, width: 1.75 },
      { cx: 272, cy: 226, r: 10, stroke: TRUST, width: 1.75 },
    ],
  },
  {
    id: "nation",
    kicker: "Nation building",
    title: "This is how a country compounds",
    body:
      "Classrooms become graduates, clinics become healthy workers, wells become farms. Every verified rupee builds the India that builds the next one.",
    paths: [
      // ground
      { d: "M20 240 H440", stroke: GRAY, width: 2 },
      // skyline, rising left to right
      { d: "M60 240 V208 H100 V240", stroke: GRAY, width: 1.75 },
      { d: "M120 240 V184 H165 V240", stroke: GRAY, width: 1.75 },
      { d: "M185 240 V150 H235 V240", stroke: TRUST, width: 1.75 },
      { d: "M255 240 V116 H310 V240", stroke: TRUST, width: 1.75 },
      // windows
      { d: "M132 200 h10 M148 200 h10 M132 216 h10 M148 216 h10", stroke: TRUST, width: 1, opacity: 0.4 },
      { d: "M197 170 h10 M215 170 h10 M197 190 h10 M215 190 h10 M197 210 h10 M215 210 h10", stroke: TRUST, width: 1, opacity: 0.4 },
      { d: "M268 136 h10 M286 136 h10 M268 158 h10 M286 158 h10 M268 180 h10 M286 180 h10", stroke: GOLD_SOFT, width: 1, opacity: 0.45 },
      // flag on the tallest tower
      { d: "M282 116 V92", stroke: GRAY, width: 1.5 },
      { d: "M282 92 H302 V102 H282", stroke: GOLD, width: 1.5 },
      // the compounding curve, gift to flag
      { d: "M80 200 C150 150 220 120 278 98", stroke: GOLD_SOFT, width: 1.25, opacity: 0.7, dash: "3 8" },
      { d: "M278 98 l-11 1 m11 -1 l-3 10", stroke: GOLD_SOFT, width: 1.25, opacity: 0.7 },
      // rising sun
      { d: "M362 118 l-7 -7 M418 118 l7 -7 M390 106 v-10", stroke: GOLD, width: 1.5, opacity: 0.7 },
    ],
    circles: [{ cx: 390, cy: 148, r: 24, stroke: GOLD, width: 1.75 }],
  },
];

const CYCLE_MS = 8000;

export default function ImpactStories() {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { once: false, margin: "-60px" });
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(0);

  // Auto-advance only while on screen; a manual pick restarts the clock
  useEffect(() => {
    if (!inView || reduceMotion) return;
    const t = setInterval(() => setActive((i) => (i + 1) % SCENES.length), CYCLE_MS);
    return () => clearInterval(t);
  }, [inView, reduceMotion, active]);

  const scene = SCENES[active];

  const draw = (i: number) =>
    reduceMotion
      ? {}
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { duration: 0.9, ease: "easeInOut" as const, delay: 0.15 + i * 0.09 },
        };

  return (
    <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">
      {/* The scene, inking itself in */}
      <div className="relative">
        <AnimatePresence mode="wait">
          <motion.svg
            key={scene.id}
            viewBox="0 0 460 280"
            fill="none"
            className="w-full"
            role="img"
            aria-label={`Illustration: ${scene.title}`}
            initial={reduceMotion ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, transition: { duration: 0.35 } }}
          >
            {scene.paths.map((p, i) => (
              <motion.path
                key={i}
                d={p.d}
                stroke={p.stroke}
                strokeWidth={p.width ?? 1.5}
                strokeOpacity={p.opacity ?? 1}
                strokeDasharray={p.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                {...draw(i)}
              />
            ))}
            {scene.circles?.map((c, i) => (
              <motion.circle
                key={i}
                cx={c.cx}
                cy={c.cy}
                r={c.r}
                stroke={c.stroke}
                strokeWidth={c.width ?? 1.5}
                {...draw(scene.paths.length + i)}
              />
            ))}
          </motion.svg>
        </AnimatePresence>
      </div>

      {/* The caption — receipt voice, human story */}
      <div className="space-y-4 text-center md:text-left">
        <AnimatePresence mode="wait">
          <motion.div
            key={scene.id}
            initial={reduceMotion ? undefined : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10, transition: { duration: 0.25 } }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3"
          >
            <p className="font-mono text-[11px] uppercase tracking-widest text-gold-400">{scene.kicker}</p>
            <h3 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white">
              {scene.title}
            </h3>
            <p className="text-gray-400 text-sm sm:text-base leading-relaxed max-w-md mx-auto md:mx-0">
              {scene.body}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Scene picker */}
        <div className="flex justify-center md:justify-start gap-2.5 pt-2">
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setActive(i)}
              aria-label={`Show story: ${s.title}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? "w-8 bg-gold-400" : "w-3 bg-gray-700 hover:bg-gray-600"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
