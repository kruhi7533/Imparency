"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import DismissButton from "./DismissButton";

interface ReEngagementCardProps {
  eventId: string;
  path: "TIER_UPGRADE" | "NGO_REFERRAL" | "GRANT_MODE" | "VOLUNTEER_ADVISOR";
  referredNgoName?: string | null;
  referredNgoId?: string | null;
  referredNgoCategories?: string[] | null;
  referredNgoDescription?: string | null;
}

export default function ReEngagementCard({
  eventId,
  path,
  referredNgoName,
  referredNgoId,
  referredNgoCategories,
  referredNgoDescription,
}: ReEngagementCardProps) {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Determine card configuration based on re-engagement type
  let title = "";
  let description = "";
  let icon = "";
  let buttonText = "";
  let destination = "/";
  let badgeText = "";
  let gradientClass = "";

  switch (path) {
    case "TIER_UPGRADE":
      title = "New Giving Tier Unlocked!";
      description = "Thank you for your generous support! Your consistent giving has upgraded your donor status. Explore matching pools and tax exemption benefits now.";
      icon = "✨";
      buttonText = "Explore Tier Benefits";
      destination = "/donor/profile";
      badgeText = "Celebration";
      gradientClass = "from-amber-500/10 via-yellow-500/5 to-transparent border-amber-500/30";
      break;

    case "NGO_REFERRAL":
      title = `Recommended NGO: ${referredNgoName || "Partner NGO"}`;
      description = `Based on your interest in ${
        referredNgoCategories && referredNgoCategories.length > 0
          ? referredNgoCategories.join(", ")
          : "transparency-first initiatives"
      }, we recommend supporting this highly-rated NGO. ${referredNgoDescription ? referredNgoDescription : ""}`;
      icon = "🤝";
      buttonText = `Discover ${referredNgoName || "NGO"}`;
      destination = referredNgoName
        ? `/discover?search=${encodeURIComponent(referredNgoName)}`
        : "/discover";
      badgeText = "Matching Recommendation";
      gradientClass = "from-emerald-500/10 via-teal-500/5 to-transparent border-emerald-500/30";
      break;

    case "GRANT_MODE":
      title = "CSR Grant Mode Eligible";
      description = "Your organization qualifies for structured co-funding options and AI-verified milestone audits. Let's look at launching a direct grant program for active projects.";
      icon = "🏢";
      buttonText = "Browse Co-Funding Projects";
      destination = "/discover";
      badgeText = "CSR & Foundations";
      gradientClass = "from-blue-500/10 via-indigo-500/5 to-transparent border-blue-500/30";
      break;

    case "VOLUNTEER_ADVISOR":
      title = "Become an Advisory Board Volunteer";
      description = "Since you've shown interest in community volunteering, join our advisory network. Help review field submissions or guide high-impact NGO projects directly.";
      icon = "📢";
      buttonText = "Join Advisor Network";
      destination = "/help";
      badgeText = "Volunteering";
      gradientClass = "from-purple-500/10 via-fuchsia-500/5 to-transparent border-purple-500/30";
      break;
  }

  const handleCtaClick = async () => {
    setIsRedirecting(true);
    try {
      // Call the click API route
      await fetch(`/api/engagement/re-engage/${eventId}/click`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      console.error("Failed to record re-engagement CTA click:", err);
    } finally {
      // Always redirect to the target location
      router.push(destination);
    }
  };

  return (
    <div className={`p-5 sm:p-6 rounded-2xl border bg-gradient-to-br ${gradientClass} flex flex-col md:flex-row items-start justify-between gap-6 shadow-lg mb-8 relative overflow-hidden transition-all duration-300`}>
      <div className="flex gap-4 items-start text-left">
        <div className="text-3xl p-3 rounded-xl bg-gray-900/50 border border-gray-800 shrink-0 select-none shadow-inner">
          {icon}
        </div>
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400">
              {badgeText}
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-black text-white leading-tight">
            {title}
          </h3>
          <p className="text-xs sm:text-sm text-gray-400 leading-relaxed max-w-2xl font-medium">
            {description}
          </p>
        </div>
      </div>

      <div className="flex sm:flex-row md:flex-col lg:flex-row items-center gap-3 w-full md:w-auto shrink-0 md:justify-end">
        <DismissButton eventId={eventId} />
        <button
          onClick={handleCtaClick}
          disabled={isRedirecting}
          className="w-full sm:w-auto px-4 py-2 text-xs font-bold text-gray-950 bg-white hover:bg-gray-100 dark:bg-emerald-400 dark:hover:bg-emerald-350 dark:text-emerald-950 rounded-xl transition duration-150 active:scale-98 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/20"
        >
          {isRedirecting ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5 text-current" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Opening...
            </>
          ) : (
            buttonText
          )}
        </button>
      </div>
    </div>
  );
}
