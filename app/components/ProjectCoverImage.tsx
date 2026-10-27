"use client";

import React, { useEffect, useRef, useState } from "react";
import { Book, Heart, Leaf, Lightbulb, Soup, Users, HelpCircle } from "lucide-react";

interface ProjectCoverImageProps {
  src?: string;
  alt: string;
  causeCategory: string;
  className?: string;
}

export default function ProjectCoverImage({
  src,
  alt,
  causeCategory,
  className = "w-full h-full object-cover object-center",
}: ProjectCoverImageProps) {
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // A server-rendered <img> can fail before React hydrates and attaches
  // onError, leaving a broken image with its alt text showing. Re-check once
  // mounted so the category fallback still appears.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setError(true);
  }, [src]);

  const getFallbackIcon = (category: string) => {
    switch (category) {
      case "Education":
        return <Book className="w-8 h-8" />;
      case "Healthcare":
        return <Heart className="w-8 h-8" />;
      case "Environment":
        return <Leaf className="w-8 h-8" />;
      case "Rural Development":
        return <Lightbulb className="w-8 h-8" />;
      case "Hunger":
        return <Soup className="w-8 h-8" />;
      case "Women Empowerment":
        return <Users className="w-8 h-8" />;
      default:
        return <HelpCircle className="w-8 h-8" />;
    }
  };

  const getFallbackGradient = (category: string) => {
    switch (category) {
      case "Education":
        return "from-blue-50 to-indigo-100 text-blue-600";
      case "Healthcare":
        return "from-rose-50 to-rose-100 text-rose-600";
      case "Environment":
        return "from-emerald-50 to-teal-100 text-emerald-700";
      case "Women Empowerment":
        return "from-purple-50 to-fuchsia-100 text-purple-700";
      case "Rural Development":
        return "from-indigo-50 to-violet-100 text-indigo-700";
      case "Hunger":
        return "from-amber-50 to-orange-100 text-amber-700";
      default:
        return "from-gray-50 to-slate-100 text-gray-600";
    }
  };

  if (error || !src) {
    const gradient = getFallbackGradient(causeCategory);
    return (
      <div className={`w-full h-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center gap-2 p-4 select-none`}>
        {getFallbackIcon(causeCategory)}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-center line-clamp-1">
          {causeCategory}
        </span>
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={className}
      onError={() => setError(true)}
    />
  );
}
