"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck } from "lucide-react";
import type { RecentDonationActivity } from "@/lib/platform-stats";

const ROTATE_MS = 4500;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function LiveActivityFeed({ activity }: { activity: RecentDonationActivity[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (activity.length <= 1 || paused) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % activity.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [activity.length, paused]);

  if (activity.length === 0) {
    return (
      <Link
        href="/discover"
        className="max-w-xl mx-auto flex items-center justify-center gap-2.5 border border-gray-800 rounded-lg bg-gray-900/70 px-6 py-4 hover:border-gold-500/40 transition"
      >
        <span className="font-display italic text-base text-gold-200">
          &ldquo;Trust isn&rsquo;t claimed, it&rsquo;s shown — one verified milestone at a time.&rdquo;
        </span>
      </Link>
    );
  }

  const current = activity[index];

  return (
    <div
      className="max-w-xl mx-auto h-12 relative"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="absolute inset-0 flex items-center gap-3 border border-gray-800 rounded-lg bg-gray-900/70 px-4 text-left"
        >
          <BadgeCheck className="w-4 h-4 shrink-0 text-emerald-400" strokeWidth={1.75} />
          <span className="text-sm text-gray-300 truncate min-w-0">
            <span className="text-white font-semibold">{current.donorFirstName}</span> funded{" "}
            <span className="text-gray-400">{current.projectTitle}</span>
          </span>
          <span className="ml-auto flex items-baseline gap-3 shrink-0">
            <span className="font-mono text-sm text-gold-300 tabular-nums">
              ₹{current.amount.toLocaleString("en-IN")}
            </span>
            <span className="font-mono text-[10px] text-gray-500">{timeAgo(current.createdAt)}</span>
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
