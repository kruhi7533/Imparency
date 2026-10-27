"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

type Tone = "trust" | "emerald" | "amber" | "violet" | "red" | "gray";

const TONES: Record<Tone, string> = {
  trust: "bg-trust-50 text-trust-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  red: "bg-red-50 text-red-600",
  gray: "bg-gray-100 text-gray-600",
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const plain = (n: number) => Math.round(n).toLocaleString("en-IN");

/** A number that counts up once on mount (instant under reduced motion). KPI rows sit at the top of the page. */
export function CountUp({ value, format = "plain", suffix = "" }: { value: number; format?: "inr" | "plain"; suffix?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 80, damping: 20, restDelta: 0.5 });
  const fmt = format === "inr" ? inr : plain;
  const text = useTransform(spring, (v) => fmt(v) + suffix);

  useEffect(() => {
    if (reduce) spring.jump(value);
    mv.set(value);
  }, [value, reduce, mv, spring]);

  return (
    <span className="tabular-nums">
      {/* Screen readers get the final figure, not the animation frames. */}
      <span className="sr-only">{fmt(value) + suffix}</span>
      <motion.span aria-hidden="true">{text}</motion.span>
    </span>
  );
}

/** Fades a section up once when it scrolls into view; static under reduced motion. */
export function FadeIn({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

export function KpiCard({
  label,
  value,
  format = "plain",
  suffix,
  display,
  sub,
  icon,
  tone = "trust",
  href,
}: {
  label: string;
  /** Numeric value to count up to. Omit and pass `display` for non-numeric states (e.g. "Pending"). */
  value?: number;
  format?: "inr" | "plain";
  suffix?: string;
  display?: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-600">{label}</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-gray-900 sm:text-[1.75rem]">
          {value !== undefined ? <CountUp value={value} format={format} suffix={suffix} /> : display}
        </p>
        {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
      </div>
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${TONES[tone]}`} aria-hidden="true">
        {icon}
      </span>
    </>
  );
  const cls =
    "flex items-start justify-between gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-md";
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Serif "Welcome back" page header with an optional right-side slot. */
export function WelcomeHeader({ name, subtitle, right }: { name: string; subtitle: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">Welcome back, {name}</h1>
        <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
      </div>
      {right}
    </header>
  );
}

export function DatePill() {
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    <span suppressHydrationWarning className="inline-flex w-fit items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      Today · {today}
    </span>
  );
}
