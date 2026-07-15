"use client";

import React, { useEffect, useRef } from "react";

// The living backdrop of the hero: a perspective-projected 3D sea of glowing
// points (the water under the bridge). Swells roll through it and points
// brighten as a crest lifts them — bands of light travel across the water —
// with a golden reflection lane down the center, as if the gold headline is
// mirrored in the sea. Gold "donation" runners stream from the horizon toward
// the viewer. Plain 2D canvas, no WebGL dependency, mouse parallax, and a
// single static frame when the user prefers reduced motion.

// Brand colors, hardcoded because canvas can't read Tailwind tokens:
// trust-200 #b9caed, trust-300 #8ea9e0, gold-300 #edc158.
const F = 320; // focal length of the projection
const Z_NEAR = 260;
const Z_FAR = 3200;
const CAM_HEIGHT = 175; // camera sits above the sea, looking out
const MAX_AMP = 102; // sum of the three wave amplitudes below

type SeaPoint = { x: number; z: number; gold: boolean; phase: number };
type Runner = { x: number; z: number; speed: number };

// Soft radial glow sprite — drawing these beats arc()/rect() for bloom,
// and one offscreen canvas serves every particle of that color
function makeSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const x = c.getContext("2d")!;
  const grad = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.25, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.12)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, size, size);
  return c;
}

export default function HeroField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const blueSprite = makeSprite(142, 169, 224); // trust-300
    const paleSprite = makeSprite(185, 202, 237); // trust-200, for bright crests
    const goldSprite = makeSprite(237, 193, 88); // gold-300

    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;

    // Pointer parallax, eased so the sea leans lazily rather than snapping
    const target = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };

    let points: SeaPoint[] = [];
    let runners: Runner[] = [];

    const build = () => {
      points = [];
      const spread = Math.max(width * 1.4, 1400);
      // Adapt density to viewport so we stay around ~2300 points on any screen
      const xStep = Math.max(48, Math.round((spread * 2) / 72));
      const zStep = 64;
      for (let z = Z_NEAR; z < Z_FAR; z += zStep) {
        for (let x = -spread; x <= spread; x += xStep) {
          points.push({
            x: x + (Math.random() - 0.5) * xStep * 0.6,
            z: z + (Math.random() - 0.5) * zStep * 0.6,
            gold: Math.random() < 0.03,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
      runners = Array.from({ length: 5 }, () => ({
        x: (Math.random() - 0.5) * spread * 1.2,
        z: Z_NEAR + Math.random() * (Z_FAR - Z_NEAR),
        speed: 240 + Math.random() * 180,
      }));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
      if (reduceMotion) draw(0, 0);
    };

    const waveY = (x: number, z: number, t: number) =>
      Math.sin(x * 0.0021 + t * 1.15) * 46 +
      Math.sin(z * 0.0017 - t * 0.75) * 34 +
      Math.cos((x + z) * 0.0009 + t * 0.45) * 22;

    const draw = (t: number, dt: number) => {
      ctx.clearRect(0, 0, width, height);

      const horizon = height * 0.42 + eased.y * 36;
      const cx = width / 2;
      const shiftX = eased.x * 130;
      // The golden reflection lane sways gently, like light on real water
      const laneCenter = Math.sin(t * 0.22) * 60;

      for (const p of points) {
        const s = F / p.z;
        const px = cx + (p.x + shiftX) * s;
        if (px < -16 || px > width + 16) continue;
        const y = waveY(p.x, p.z, t);
        const py = horizon + (CAM_HEIGHT + y) * s;
        if (py < -16 || py > height + 16) continue;

        const depth = Math.max(0, Math.min(1, 1.25 - p.z / (Z_FAR * 0.85)));
        // Crest lighting: a lifted point catches the light, a trough goes dark.
        // This is what makes the swell visibly ROLL instead of reading as dust.
        const crest = (MAX_AMP - y) / (2 * MAX_AMP); // wave lifts toward the camera (negative y)
        const shimmer = 0.25 + 0.75 * crest * crest;

        if (p.gold) {
          const twinkle = 0.55 + 0.45 * Math.sin(t * 2.2 + p.phase);
          const size = Math.max(3, 11 * s) * (0.8 + crest * 0.6);
          ctx.globalAlpha = Math.min(1, depth * twinkle * shimmer * 1.6);
          ctx.drawImage(goldSprite, px - size / 2, py - size / 2, size, size);
        } else {
          // Inside the reflection lane, crests catch the headline's gold
          const lane = Math.exp(-((p.x - laneCenter) ** 2) / (2 * 240 * 240));
          const size = Math.max(2.5, 9 * s) * (0.75 + crest * 0.7);
          if (lane > 0.25 && crest > 0.45) {
            ctx.globalAlpha = Math.min(1, depth * shimmer * lane * 1.1);
            ctx.drawImage(goldSprite, px - size / 2, py - size / 2, size, size);
          } else {
            const sprite = crest > 0.62 ? paleSprite : blueSprite;
            ctx.globalAlpha = Math.min(1, depth * shimmer * 0.95);
            ctx.drawImage(sprite, px - size / 2, py - size / 2, size, size);
          }
        }
      }

      // Gold runners — donations crossing the water toward the viewer
      for (const run of runners) {
        run.z -= run.speed * dt;
        if (run.z < Z_NEAR * 0.9) {
          run.z = Z_FAR;
          run.x = (Math.random() - 0.5) * Math.max(width * 1.4, 1400) * 1.2;
          run.speed = 240 + Math.random() * 180;
        }
        // Comet trail fading off behind the head
        for (let i = 0; i < 5; i++) {
          const tz = run.z + i * 42;
          if (tz > Z_FAR) continue;
          const s = F / tz;
          const px = cx + (run.x + shiftX) * s;
          const py = horizon + (CAM_HEIGHT + waveY(run.x, tz, t) - 26) * s;
          const size = Math.max(3, (16 - i * 2.4) * s);
          ctx.globalAlpha = (0.95 - i * 0.18) * Math.max(0, Math.min(1, 1.3 - tz / Z_FAR));
          ctx.drawImage(goldSprite, px - size / 2, py - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      eased.x += (target.x - eased.x) * 0.045;
      eased.y += (target.y - eased.y) * 0.045;
      draw(now * 0.001, dt);
    };

    const onPointer = (e: PointerEvent) => {
      target.x = e.clientX / window.innerWidth - 0.5;
      target.y = e.clientY / window.innerHeight - 0.5;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 }
    );
    observer.observe(canvas);

    resize();
    window.addEventListener("resize", resize);
    if (!reduceMotion) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return <canvas ref={canvasRef} data-hero-field aria-hidden className="w-full h-full" />;
}
